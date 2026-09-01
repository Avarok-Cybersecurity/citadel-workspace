use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

// # Membership visibility across the two workspace representations
//
// The root workspace is stored TWICE: once as a `Workspace` record and once,
// denormalized, inside `Domain::Workspace`. `UpdateWorkspaceTheme` documents
// keeping the two in sync as an invariant that "every other workspace mutator
// also writes" — but `add_user_to_domain` and `remove_user_from_domain` wrote
// only the `Workspace` record, and `ListMembers` reads the `Domain` copy FIRST.
//
// The result needed no race: an added member never appeared in the roster and a
// removed one never left it, while `is_member_of_domain` — which reads the
// fresh `Workspace` record — enforced the true list. The displayed roster and
// the enforced roster disagreed permanently, in both directions.
//
// These tests read through `ListMembers` rather than the backend, because the
// backend is exactly where the two copies still look fine individually.

/// The workspace-root roster exactly as a client sees it, via ListMembers.
async fn roster<R: citadel_sdk::prelude::Ratchet>(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<R>,
) -> Vec<String> {
    let listed = execute_command(
        kernel,
        WorkspaceProtocolRequest::ListMembers { domain_id: None },
    )
    .await
    .expect("ListMembers dispatch failed");
    let WorkspaceProtocolResponse::Members { members, .. } = listed else {
        panic!("expected Members, got {listed:?}");
    };
    members.into_iter().map(|m| m.id).collect()
}

#[tokio::test]
async fn added_member_appears_in_the_roster() {
    let kernel = create_test_kernel().await;

    let response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "roster_probe_user".to_string(),
            domain_id: None, // workspace root
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await
    .expect("AddMember dispatch failed");

    assert!(
        !matches!(response, WorkspaceProtocolResponse::Error(_)),
        "AddMember itself failed: {response:?}"
    );

    let listed = execute_command(
        &kernel,
        WorkspaceProtocolRequest::ListMembers { domain_id: None },
    )
    .await
    .expect("ListMembers dispatch failed");

    let WorkspaceProtocolResponse::Members { members, .. } = listed else {
        panic!("expected Members, got {listed:?}");
    };

    assert!(
        members.iter().any(|m| m.id == "roster_probe_user"),
        "AddMember reported success and the member is absent from ListMembers. \
         The roster reads the denormalized Domain copy; the mutator wrote only \
         the Workspace record. Members present: {:?}",
        members.iter().map(|m| &m.id).collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn removed_member_leaves_the_roster() {
    let kernel = create_test_kernel().await;

    execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "departing_user".to_string(),
            domain_id: None,
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await
    .expect("AddMember dispatch failed");

    // Establish that they are VISIBLE before removing them. Without this the
    // test passes for the wrong reason: if the add never reached the Domain
    // copy, the final "absent from the roster" assertion is trivially true and
    // the removal path is not exercised at all. Confirmed by negative control —
    // this test passed with the fix fully reverted until this assertion existed.
    assert!(
        roster(&kernel)
            .await
            .contains(&"departing_user".to_string()),
        "precondition: the member must be listed before removal means anything"
    );

    execute_command(
        &kernel,
        WorkspaceProtocolRequest::RemoveMember {
            user_id: "departing_user".to_string(),
            domain_id: None,
        },
    )
    .await
    .expect("RemoveMember dispatch failed");

    assert!(
        !roster(&kernel)
            .await
            .contains(&"departing_user".to_string()),
        "RemoveMember succeeded and the member is STILL in the roster — the \
         stale Domain copy outlives the removal, so a removed user appears \
         listed forever"
    );
}

/// # A created workspace must be readable by the user who created it
///
/// `is_member_of_domain` special-cased `domain_id == WORKSPACE_ROOT_ID` and
/// looked everything else up as a `DomainNode`. Every workspace that
/// `create_workspace` mints gets a UUID and is stored as a `Workspace`, never as
/// a node — so the lookup missed and membership returned false to EVERYONE,
/// including the creator, who had been written into `members` moments earlier.
/// Global Admin does not help: this path uses `is_member_of_domain` directly and
/// has no admin short-circuit.
#[tokio::test]
async fn a_created_workspace_is_readable_by_its_creator() {
    let kernel = create_test_kernel().await;

    let created = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: "Second Workspace".to_string(),
            description: "created, then read back by its creator".to_string(),
            workspace_master_password: "admin-password".to_string(),
            metadata: None,
        },
    )
    .await
    .expect("CreateWorkspace dispatch failed");

    let WorkspaceProtocolResponse::Workspace(workspace) = created else {
        panic!("expected Workspace, got {created:?}");
    };
    assert_ne!(
        workspace.id,
        citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
        "this test is only meaningful for a non-root workspace"
    );

    let fetched = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetWorkspace {
            workspace_id: Some(workspace.id.clone()),
        },
    )
    .await
    .expect("GetWorkspace dispatch failed");

    assert!(
        matches!(fetched, WorkspaceProtocolResponse::Workspace(_)),
        "the creator cannot read the workspace they just created: {fetched:?}. \
         Every non-root workspace was written and then permanently unreachable."
    );
}
