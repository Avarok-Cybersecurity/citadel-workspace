//! # The workspace's default tabs: set under `EditWorkspaceConfig`, provisioned once
//!
//! A node without an `app_tabs` list of its own shows the workspace's `default_app_tabs`. Setting
//! it is a workspace configuration change; a workspace gets the provisioned list at boot when it
//! has none, and never over a list an administrator chose.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{NodeEntityType, Permission};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::async_test_helpers::execute_command;
use common::member_test_utils::create_test_user;
use common::roles_fixture::MEMBER_ROLE_ID;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD, TEST_ADMIN_USER_ID};
use serde_json::{json, Value};

/// `user`, a member of a new office holding exactly `permissions` there.
async fn member_of_an_office(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
        citadel_sdk::prelude::MonoRatchet,
    >,
    user: &str,
    permissions: Vec<Permission>,
) {
    let created = execute_command(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Platform".to_string(),
            description: String::new(),
            metadata: None,
        },
    )
    .await
    .expect("CreateNode dispatch");
    let WorkspaceProtocolResponse::Node(office) = created else {
        panic!("expected Node, got {created:?}");
    };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(user.to_string(), create_test_user(user, MEMBER_ROLE_ID))
        .await
        .expect("insert user");
    for request in [
        WorkspaceProtocolRequest::AddMember {
            user_id: user.to_string(),
            domain_id: Some(office.id.clone()),
            role: MEMBER_ROLE_ID.to_string(),
            metadata: None,
        },
        WorkspaceProtocolRequest::UpdateMemberPermissions {
            user_id: user.to_string(),
            domain_id: office.id.clone(),
            permissions,
            operation: UpdateOperation::Set,
        },
    ] {
        execute_command(kernel, request).await.expect("dispatch");
    }
}

fn root_metadata(response: &WorkspaceProtocolResponse) -> Value {
    match response {
        WorkspaceProtocolResponse::Workspace(workspace) => {
            serde_json::from_slice(&workspace.metadata).unwrap()
        }
        other => panic!("expected the workspace, got {other:?}"),
    }
}

#[tokio::test]
async fn the_workspace_default_needs_edit_workspace_config() {
    let kernel = create_test_kernel().await;
    member_of_an_office(&kernel, "member", vec![Permission::UpdateNodeSettings]).await;
    let request = WorkspaceProtocolRequest::SetDefaultAppTabs {
        app_tabs: vec!["com.acme.kanban".to_string()],
    };

    let refused = process_command_with_user(&kernel, &request, "member")
        .await
        .unwrap();
    assert!(
        matches!(refused, WorkspaceProtocolResponse::Error(ref e) if e.contains("EditWorkspaceConfig"))
    );

    let set = process_command_with_user(&kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .unwrap();
    let metadata = root_metadata(&set);
    assert_eq!(metadata["default_app_tabs"], json!(["com.acme.kanban"]));
}

#[tokio::test]
async fn the_workspace_default_is_held_to_the_list_rules() {
    let kernel = create_test_kernel().await;
    let request = WorkspaceProtocolRequest::SetDefaultAppTabs {
        app_tabs: vec!["com.acme.a".to_string(), "com.acme.a".to_string()],
    };
    let answer = process_command_with_user(&kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .unwrap();
    assert!(
        matches!(answer, WorkspaceProtocolResponse::Error(_)),
        "{answer:?}"
    );
}

#[tokio::test]
async fn a_booted_workspace_has_the_provisioned_default_and_keeps_a_chosen_one() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let read = || async {
        let workspace = backend
            .get_workspace(WORKSPACE_ROOT_ID)
            .await
            .unwrap()
            .unwrap();
        serde_json::from_slice::<Value>(&workspace.metadata).unwrap()["default_app_tabs"].clone()
    };
    assert_eq!(read().await, json!(["net.avarok.calendar"]));

    let request = WorkspaceProtocolRequest::SetDefaultAppTabs { app_tabs: vec![] };
    process_command_with_user(&kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .unwrap();
    kernel.inject_admin_user(TEST_ADMIN_PASSWORD).await.unwrap();
    assert_eq!(
        read().await,
        json!([]),
        "a second boot overwrote an administrator's choice"
    );
}
