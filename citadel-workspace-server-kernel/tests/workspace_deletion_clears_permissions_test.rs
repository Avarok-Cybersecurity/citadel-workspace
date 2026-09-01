//! Deleting a workspace must not leave its permission entries behind.
//!
//! `create_workspace` grants the creator `permissions[workspace_id]`, and
//! `add_member` grants each member one. `remove_member` already clears its own
//! domain's entry — the fix was applied there and never propagated to the path
//! that removes the whole workspace, so every deletion leaked one entry per
//! member. Unreachable, since ids are server-minted UUIDs that are never
//! reissued, but unbounded across deletions.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

const MEMBER: &str = "member-who-held-permissions";

type Kernel = citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
    citadel_sdk::prelude::MonoRatchet,
>;

async fn permissions_of(kernel: &Kernel, id: &str) -> HashMap<String, Vec<String>> {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(id)
        .await
        .expect("read user")
        .map(|u| {
            u.permissions
                .into_iter()
                .map(|(k, v)| (k, v.into_iter().map(|p| format!("{p:?}")).collect()))
                .collect()
        })
        .unwrap_or_default()
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

/// Seeds a second holder directly. The shape is the one `remove_member` clears
/// (`user.permissions` keyed by domain id), so this is the real state, not an
/// invented one.
async fn seed_member_with_permissions(kernel: &Kernel, workspace_id: &str) {
    let mut permissions = HashMap::new();
    permissions.insert(workspace_id.to_string(), Default::default());
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            MEMBER.to_string(),
            User {
                id: MEMBER.to_string(),
                name: MEMBER.to_string(),
                role: UserRole::Member,
                permissions,
                metadata: Default::default(),
            },
        )
        .await
        .expect("insert member");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_a_workspace_clears_every_members_permission_entry() {
    let kernel = create_test_kernel().await;
    let id = create_workspace(&kernel, "Doomed").await;
    seed_member_with_permissions(&kernel, &id).await;

    // Positive control: without this the assertions below would pass against a
    // workspace nobody ever held permissions for.
    assert!(
        permissions_of(&kernel, TEST_ADMIN_USER_ID)
            .await
            .contains_key(&id),
        "create_workspace should have granted the creator an entry",
    );
    assert!(
        permissions_of(&kernel, MEMBER).await.contains_key(&id),
        "the member should be holding a seeded entry",
    );

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_id: Some(id.clone()),
            workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");
    assert!(
        !matches!(response, WorkspaceProtocolResponse::Error(_)),
        "the delete itself must succeed; got {response:?}"
    );

    assert!(
        !permissions_of(&kernel, TEST_ADMIN_USER_ID)
            .await
            .contains_key(&id),
        "the creator kept a permissions entry for a workspace that no longer exists",
    );
    assert!(
        !permissions_of(&kernel, MEMBER).await.contains_key(&id),
        "a member kept a permissions entry for a workspace that no longer exists",
    );
}

/// The cleanup must take only the deleted workspace's entry.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_one_workspace_leaves_another_workspaces_permissions_alone() {
    let kernel = create_test_kernel().await;
    let doomed = create_workspace(&kernel, "Doomed").await;
    let kept = create_workspace(&kernel, "Kept").await;

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_id: Some(doomed.clone()),
            workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");
    assert!(
        !matches!(response, WorkspaceProtocolResponse::Error(_)),
        "the delete itself must succeed; got {response:?}"
    );

    let perms = permissions_of(&kernel, TEST_ADMIN_USER_ID).await;
    assert!(
        !perms.contains_key(&doomed),
        "the deleted workspace's entry survived"
    );
    assert!(
        perms.contains_key(&kept),
        "a surviving workspace's permissions were cleared too",
    );
}
