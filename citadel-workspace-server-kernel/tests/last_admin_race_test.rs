use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

// # A workspace must never reach zero administrators
//
// The guard's own doc explains why that state is terminal: *"Demoting or
// removing the last Admin is unrecoverable: promotion requires an admin, so
// there is no way back."*
//
// SCOPE, stated plainly: this covers the SEQUENTIAL invariant only — that the
// guard refuses a removal which would empty the admin set. It does NOT cover
// the concurrent case that motivated the lock, where two admins remove each
// other, both counts complete before either write, and both pass.
//
// That interleaving cannot be asserted deterministically from here: the window
// between the count and the write is scheduler-dependent, and a probabilistic
// test that usually passes is worse than none — it reads as coverage. Verified
// by control: this test passes with the lock removed, which is exactly why it
// must not be described as testing the race.
//
// What protects the concurrent case is holding `lock_workspaces` across the
// check AND the write, in all three role writers. The lock primitive itself has
// a 25-way concurrency test in transaction/mod.rs.

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

    let WorkspaceProtocolResponse::Members { members, .. } = listed else {
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

/// The lock IS the protection, so the lock is what this asserts.
///
/// The previous version listed two of the three role writers and checked each
/// body for the string `lock_workspaces()`. It omitted `add_user_to_domain` —
/// whose docstring above says why: that function's guard is scoped to its
/// workspace-root branch and has dropped by the time the demote check runs.
/// Adding it to that list would have PASSED WITHOUT FIXING ANYTHING, because
/// the string is present in the branch above. A guard answering a narrower
/// question than its name.
///
/// This asserts the invariant instead of a neighbourhood: EVERY site that can
/// write a non-Admin role must sit in a function that holds `lock_workspaces()`,
/// so the last-admin count and the write cannot interleave. Writing the literal
/// `UserRole::Admin` is exempt and only that — a promotion cannot empty the
/// admin set. Enumerating the sites rather than naming functions is the point:
/// this found two role writers the previous test did not know existed.
///
/// LIMIT, stated because it is the same limit that let the old test pass: this
/// checks that the ENCLOSING FUNCTION takes the lock somewhere, not that the
/// lock is still held at the assignment. A writer reintroduced inside
/// `add_user_to_domain` would satisfy it, because that function locks in its
/// workspace-root branch. Verified by control — reintroducing exactly that
/// leaves this test green. What forbids it is
/// `every_role_writer_calls_the_guarded_writer` below, which requires the role
/// change to go through the one function where lock, check and write are
/// adjacent. Neither test is sufficient alone.
#[test]
fn every_demoting_role_write_is_under_the_workspace_lock() {
    let source = include_str!("../src/handlers/domain/server_ops/async_domain_server_ops.rs");

    // Comments stripped first: this campaign has already produced one source
    // assertion that matched the comment explaining the code's absence.
    let lines: Vec<&str> = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect();

    // Where each `fn` begins, so an assignment can be attributed to its owner.
    let fn_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| {
            let t = l.trim_start();
            t.starts_with("fn ")
                || t.starts_with("async fn ")
                || t.starts_with("pub fn ")
                || t.starts_with("pub async fn ")
        })
        .map(|(i, _)| i)
        .collect();

    let mut checked = 0usize;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        // An assignment, not a comparison.
        if !trimmed.contains(".role = ") {
            continue;
        }
        // A promotion to Admin cannot empty the admin set.
        if trimmed.contains(".role = UserRole::Admin;") {
            continue;
        }
        checked += 1;

        let owner_idx = *fn_starts
            .iter()
            .rfind(|&&f| f < i)
            .expect("a role assignment outside any function");
        let end = fn_starts
            .iter()
            .find(|&&f| f > owner_idx)
            .copied()
            .unwrap_or(lines.len());
        let owner = lines[owner_idx].trim();
        let body = lines[owner_idx..end].join("\n");

        assert!(
            body.contains("lock_workspaces()"),
            "`{trimmed}` (line {}) sits in `{owner}`, which does not hold \
             lock_workspaces(). Its last-admin check and its write can therefore \
             interleave with another role writer: two admins demoting each other \
             both pass the guard and the workspace is left with zero admins, \
             which is unrecoverable because promotion requires an admin.",
            i + 1
        );
    }

    assert!(
        checked >= 2,
        "found only {checked} demoting role write(s). The two that exist are in \
         write_user_role and remove_user_from_domain; finding fewer means this \
         test's matcher has stopped seeing them and is asserting nothing."
    );
}

/// Every caller that changes a role must go through the one guarded writer.
#[test]
fn every_role_writer_calls_the_guarded_writer() {
    let source = include_str!("../src/handlers/domain/server_ops/async_domain_server_ops.rs");
    let code: String = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    for writer in [
        "async fn update_workspace_member_role",
        "async fn add_user_to_domain",
    ] {
        let start = code
            .find(writer)
            .unwrap_or_else(|| panic!("{writer} no longer exists; update this test"));
        let rest = &code[start + writer.len()..];
        let end = rest.find("\n    async fn ").unwrap_or(rest.len());
        let body = &rest[..end];

        assert!(
            body.contains("write_user_role("),
            "{writer} changes a user's role without going through write_user_role, \
             so its last-admin check and its write are not under one lock."
        );
    }

    let start = code
        .find("async fn write_user_role")
        .expect("write_user_role no longer exists; update this test");
    let rest = &code[start..];
    let end = rest[1..]
        .find("\n    async fn ")
        .map(|i| i + 1)
        .unwrap_or(rest.len());
    let body = &rest[..end];
    assert!(
        body.contains("lock_workspaces()") && body.contains("ensure_not_last_admin"),
        "write_user_role must hold the workspace lock AND run the last-admin \
         check; it is the single place both happen together."
    );
}
