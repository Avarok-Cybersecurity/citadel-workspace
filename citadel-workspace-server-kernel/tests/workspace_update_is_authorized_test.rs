//! Updating a workspace requires standing, not just a shared secret.
//!
//! `update_workspace` gated on the master password alone, and then did three
//! things to whoever presented it: added them to `members`, and — at the end,
//! unconditionally — set `role = Admin` and wrote the matching permissions.
//!
//! That is correct exactly once. The seeded root workspace starts with no owner
//! and the documented bootstrap is that "the first user to provide the master
//! password via UpdateWorkspace becomes the owner" (see `UNASSIGNED_OWNER`).
//! The door simply never closed behind it. And the password is not a
//! per-workspace secret: `create_workspace` verifies against ROOT's password
//! and then stores that same value as the new workspace's own, so every
//! workspace creator holds the one secret that opened every workspace.
//!
//! The sibling `delete_workspace` was given an admin-or-owner check and says so
//! in its own comment. This was its unguarded twin.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

const OUTSIDER: &str = "outsider";

type Kernel = citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
    citadel_sdk::prelude::MonoRatchet,
>;

async fn add_member(kernel: &Kernel, id: &str) {
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            id.to_string(),
            User {
                id: id.to_string(),
                name: id.to_string(),
                role: UserRole::Member,
                permissions: HashMap::new(),
                metadata: Default::default(),
            },
        )
        .await
        .expect("insert user");
}

async fn create_workspace(kernel: &Kernel, name: &str) -> String {
    let response = process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::CreateWorkspace {
            name: name.to_string(),
            description: String::new(),
            metadata: None,
            workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");
    match response {
        WorkspaceProtocolResponse::Workspace(w) => w.id,
        other => panic!("expected a Workspace response, got {other:?}"),
    }
}

async fn update_as(
    kernel: &Kernel,
    id: &str,
    actor: &str,
    name: Option<&str>,
) -> WorkspaceProtocolResponse {
    process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::UpdateWorkspace {
            workspace_id: Some(id.to_string()),
            name: name.map(str::to_string),
            description: None,
            metadata: None,
            // The correct password. That is the point: knowing it is not enough.
            workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
        },
        actor,
    )
    .await
    .expect("dispatch")
}

/// A workspace with no owner and the shared master password on it -- the state
/// the seeded root workspace boots in.
async fn seed_unowned_workspace(kernel: &Kernel, id: &str) -> String {
    let mgr = &kernel.domain_operations.backend_tx_manager;
    mgr.insert_workspace(
        id.to_string(),
        citadel_workspace_types::structs::Workspace {
            id: id.to_string(),
            name: "Unclaimed".to_string(),
            description: String::new(),
            owner_id: String::new(),
            members: Vec::new(),
            offices: Vec::new(),
            metadata: Vec::new(),
        },
    )
    .await
    .expect("insert workspace");
    mgr.set_workspace_password(id, TEST_ADMIN_PASSWORD)
        .await
        .expect("set password");
    id.to_string()
}

async fn role_of(kernel: &Kernel, id: &str) -> UserRole {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(id)
        .await
        .expect("read user")
        .expect("user exists")
        .role
}

/// The consequence, not the message: a refusal that still promoted the caller
/// would pass an assertion about the error string alone.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_master_password_does_not_make_an_outsider_an_admin() {
    let kernel = create_test_kernel().await;
    add_member(&kernel, OUTSIDER).await;
    let id = create_workspace(&kernel, "Engineering").await;

    let response = update_as(&kernel, &id, OUTSIDER, Some("Owned")).await;

    assert!(
        matches!(&response, WorkspaceProtocolResponse::Error(e) if e.contains("Permission denied")),
        "the master password is shared across every workspace, so it cannot be \
         the only gate; got {response:?}"
    );
    assert_eq!(
        role_of(&kernel, OUTSIDER).await,
        UserRole::Member,
        "presenting the shared master password must not promote anyone to Admin",
    );

    let workspace = kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(&id)
        .await
        .expect("read workspace")
        .expect("workspace exists");
    assert!(
        !workspace.members.contains(&OUTSIDER.to_string()),
        "a refused update must not have added the caller to the workspace",
    );
    assert_ne!(
        workspace.name, "Owned",
        "a refused update must not have applied its changes",
    );
}

/// The bootstrap this gate must not break: the seeded root workspace has no
/// owner, and claiming it with the master password is how the first admin is
/// established. If this fails, onboarding is broken.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_first_claim_of_an_unowned_workspace_still_works() {
    let kernel = create_test_kernel().await;
    add_member(&kernel, OUTSIDER).await;

    // create_test_kernel() already claims root for the test admin, so seed a
    // genuinely unowned one. (The precondition assertion that used to sit here
    // is what caught that -- worth keeping the lesson: assert the state you
    // think you are testing against.)
    let unowned = seed_unowned_workspace(&kernel, "unclaimed").await;

    let response = update_as(&kernel, &unowned, OUTSIDER, None).await;

    assert!(
        !matches!(response, WorkspaceProtocolResponse::Error(_)),
        "claiming an unowned workspace with the master password is the \
         documented bootstrap; got {response:?}"
    );
    assert_eq!(
        role_of(&kernel, OUTSIDER).await,
        UserRole::Admin,
        "the claimant becomes the first admin",
    );
}

/// And the door is shut behind that claim: a second caller with the same
/// password gets nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_second_caller_cannot_reclaim_a_claimed_workspace() {
    let kernel = create_test_kernel().await;
    add_member(&kernel, OUTSIDER).await;
    add_member(&kernel, "latecomer").await;

    let unowned = seed_unowned_workspace(&kernel, "unclaimed").await;
    update_as(&kernel, &unowned, OUTSIDER, None).await;

    let response = update_as(&kernel, &unowned, "latecomer", None).await;

    assert!(
        matches!(&response, WorkspaceProtocolResponse::Error(e) if e.contains("Permission denied")),
        "the bootstrap is a one-time claim, not a standing entitlement; got {response:?}"
    );
    assert_eq!(
        role_of(&kernel, "latecomer").await,
        UserRole::Member,
        "a second claimant must not be promoted",
    );
}

/// Administration must still work.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_can_still_update_a_workspace() {
    let kernel = create_test_kernel().await;
    let id = create_workspace(&kernel, "Before").await;

    let response = update_as(&kernel, &id, TEST_ADMIN_USER_ID, Some("After")).await;

    assert!(
        !matches!(response, WorkspaceProtocolResponse::Error(_)),
        "administration must still work; got {response:?}"
    );
    assert_eq!(
        kernel
            .domain_operations
            .backend_tx_manager
            .get_workspace(&id)
            .await
            .expect("read workspace")
            .expect("workspace exists")
            .name,
        "After",
        "an accepted update must actually apply",
    );
}
