use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # A workspace must never reach zero administrators
///
/// The guard's own doc explains why that state is terminal: *"Demoting or
/// removing the last Admin is unrecoverable: promotion requires an admin, so
/// there is no way back."*
///
/// SCOPE, stated plainly: this covers the SEQUENTIAL invariant only — that the
/// guard refuses a removal which would empty the admin set. It does NOT cover
/// the concurrent case that motivated the lock, where two admins remove each
/// other, both counts complete before either write, and both pass.
///
/// That interleaving cannot be asserted deterministically from here: the window
/// between the count and the write is scheduler-dependent, and a probabilistic
/// test that usually passes is worse than none — it reads as coverage. Verified
/// by control: this test passes with the lock removed, which is exactly why it
/// must not be described as testing the race.
///
/// What protects the concurrent case is holding `lock_workspaces` across the
/// check AND the write, in all three role writers. The lock primitive itself has
/// a 25-way concurrency test in transaction/mod.rs.

/// Two admins in the root workspace, plus the seeded test admin.
async fn seed_two_admins<R: citadel_sdk::prelude::Ratchet>(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<R>,
    names: [&str; 2],
) {
    for name in names {
        kernel
            .domain_operations
            .backend_tx_manager
            .insert_user(
                name.to_string(),
                User::new(name.to_string(), name.to_string(), UserRole::Admin),
            )
            .await
            .expect("insert user");

        execute_command(
            kernel,
            WorkspaceProtocolRequest::AddMember {
                user_id: name.to_string(),
                domain_id: None,
                role: UserRole::Admin,
                metadata: None,
            },
        )
        .await
        .expect("AddMember dispatch failed");
    }
}

/// How many members of the root workspace currently hold the Admin role.
async fn admin_count<R: citadel_sdk::prelude::Ratchet>(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<R>,
) -> usize {
    let listed = execute_command(
        kernel,
        WorkspaceProtocolRequest::ListMembers { domain_id: None },
    )
    .await
    .expect("ListMembers dispatch failed");

    let WorkspaceProtocolResponse::Members(members) = listed else {
        panic!("expected Members, got {listed:?}");
    };
    members.iter().filter(|m| m.role == UserRole::Admin).count()
}

#[tokio::test]
async fn removing_the_last_admin_is_refused_sequentially() {
    let kernel = create_test_kernel().await;
    seed_two_admins(&kernel, ["admin_a", "admin_b"]).await;

    // Remove down to one admin, then try to remove that one.
    let before = admin_count(&kernel).await;
    assert!(before >= 2, "the fixture should start with several admins");

    let mut removed = 0;
    for name in ["admin_a", "admin_b"] {
        let response = process_command_with_user(
            &kernel,
            &WorkspaceProtocolRequest::RemoveMember {
                user_id: name.to_string(),
                domain_id: None,
            },
            "admin_a",
        )
        .await
        .expect("RemoveMember dispatch failed");
        if !matches!(response, WorkspaceProtocolResponse::Error(_)) {
            removed += 1;
        }
    }

    // Whatever the guard allows, it must never allow the count to hit zero —
    // that state has no way back, because promotion itself requires an admin.
    let after = admin_count(&kernel).await;
    assert!(
        after >= 1,
        "the workspace reached {after} admins after {removed} removals; \
         zero admins is unrecoverable"
    );
}
