//! Deleting a workspace requires standing, not just a shared secret.
//!
//! `delete_workspace` discarded its actor — the parameter was literally
//! `_user_id` — so the master password was the entire gate. And
//! `create_workspace` stores ROOT's master password against every workspace it
//! mints, so possession of that one secret authorised deleting ANY non-root
//! workspace, by any authenticated account, member or not. Every workspace
//! creator holds it.
//!
//! The password remains as a second factor. It is no longer the only one.

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

/// Mints a workspace as the admin and returns its id.
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

async fn delete_as(kernel: &Kernel, id: &str, actor: &str) -> WorkspaceProtocolResponse {
    process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_id: Some(id.to_string()),
            // The correct password. That is the point: knowing it is not enough.
            workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
        },
        actor,
    )
    .await
    .expect("dispatch")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_with_the_password_cannot_delete_someone_elses_workspace() {
    let kernel = create_test_kernel().await;
    add_member(&kernel, OUTSIDER).await;
    let id = create_workspace(&kernel, "Engineering").await;

    let response = delete_as(&kernel, &id, OUTSIDER).await;

    assert!(
        matches!(&response, WorkspaceProtocolResponse::Error(e) if e.contains("Permission denied")),
        "the master password is shared across every workspace, so it cannot be \
         the only gate; got {response:?}"
    );

    // And it is still there.
    assert!(
        kernel
            .domain_operations
            .backend_tx_manager
            .get_workspace(&id)
            .await
            .expect("read workspace")
            .is_some(),
        "a refused delete must not have deleted anything",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_can_still_delete_a_workspace() {
    let kernel = create_test_kernel().await;
    let id = create_workspace(&kernel, "Doomed").await;

    let response = delete_as(&kernel, &id, TEST_ADMIN_USER_ID).await;

    assert!(
        !matches!(response, WorkspaceProtocolResponse::Error(_)),
        "administration must still work; got {response:?}"
    );
    assert!(
        kernel
            .domain_operations
            .backend_tx_manager
            .get_workspace(&id)
            .await
            .expect("read workspace")
            .is_none(),
        "an accepted delete must actually delete",
    );
}

/// The password key must die with the workspace — and `remove_workspace` is
/// the ONLY place that deletes it. `delete_workspace` used to follow up with
/// `passwords.remove(id)` + `save_passwords(..)`, which looked like the
/// deletion but deleted nothing: `save_passwords` is upsert-only. That
/// decoy has been removed, so this test guards the one real cleanup path
/// against being "simplified" away.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_a_workspace_deletes_its_password_key() {
    let kernel = create_test_kernel().await;
    let id = create_workspace(&kernel, "Ephemeral").await;

    // The password was stored at creation.
    assert!(
        kernel
            .domain_operations
            .backend_tx_manager
            .get_workspace_password(&id)
            .await
            .expect("read password")
            .is_some(),
        "creation must store the workspace's password",
    );

    let response = delete_as(&kernel, &id, TEST_ADMIN_USER_ID).await;
    assert!(
        !matches!(response, WorkspaceProtocolResponse::Error(_)),
        "delete must succeed; got {response:?}"
    );

    assert!(
        kernel
            .domain_operations
            .backend_tx_manager
            .get_workspace_password(&id)
            .await
            .expect("read password")
            .is_none(),
        "the password key must be deleted with the workspace — a leftover key \
         leaks secret material and would re-associate if the id were reused",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_root_workspace_is_still_undeletable() {
    let kernel = create_test_kernel().await;

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_id: None,
            workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");

    assert!(
        matches!(response, WorkspaceProtocolResponse::Error(_)),
        "root deletion is refused ahead of any permission question; got {response:?}"
    );
}
