//! # A node's tabs are its settings, and only who may configure the node changes them
//!
//! `UpdateNode.metadata` is how a node's app tabs (and its time-zone override) are written; the
//! workspace's `default_app_tabs` is what a node without its own list shows. These drive the
//! request layer as a NON-admin, because `check_entity_permission` short-circuits for admins and
//! would make every refusal below vacuous.

use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::async_test_helpers::execute_command;
use common::member_test_utils::create_test_user;
use common::workspace_test_utils::create_test_kernel;
use serde_json::{json, Value};
use std::time::Duration;

type Kernel = AsyncWorkspaceServerKernel<citadel_sdk::prelude::MonoRatchet>;

/// An office, and `user` a member of it holding exactly `permissions` there.
async fn office_with_member(kernel: &Kernel, user: &str, permissions: Vec<Permission>) -> String {
    let created = execute_command(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Platform".to_string(),
            description: String::new(),
            metadata: Some(br#"{"keep":"me"}"#.to_vec()),
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
        .insert_user(user.to_string(), create_test_user(user, UserRole::Member))
        .await
        .expect("insert user");
    for request in [
        WorkspaceProtocolRequest::AddMember {
            user_id: user.to_string(),
            domain_id: Some(office.id.clone()),
            role: UserRole::Member.into(),
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
    office.id
}

fn set_tabs(node_id: &str, patch: Value, mdx: Option<&str>) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateNode {
        node_id: node_id.to_string(),
        name: None,
        description: None,
        mdx_content: mdx.map(str::to_string),
        rules: None,
        chat_enabled: None,
        is_default: None,
        metadata: Some(serde_json::to_vec(&patch).unwrap()),
    }
}

async fn stored_metadata(kernel: &Kernel, node_id: &str) -> Value {
    let nodes = kernel
        .domain_operations
        .backend_tx_manager
        .get_all_nodes()
        .await
        .unwrap();
    serde_json::from_slice(&nodes[node_id].metadata).unwrap_or(Value::Null)
}

#[tokio::test]
async fn a_member_without_update_node_settings_cannot_change_the_tabs() {
    let kernel = create_test_kernel().await;
    let office = office_with_member(&kernel, "editor", vec![Permission::EditMdx]).await;

    let answer = process_command_with_user(
        &kernel,
        &set_tabs(&office, json!({"app_tabs": ["com.acme.kanban"]}), None),
        "editor",
    )
    .await
    .unwrap();

    assert!(
        matches!(answer, WorkspaceProtocolResponse::Error(ref e) if e.contains("UpdateNodeSettings"))
    );
    assert!(stored_metadata(&kernel, &office)
        .await
        .get("app_tabs")
        .is_none());
}

#[tokio::test]
async fn update_node_settings_alone_sets_the_tabs_and_keeps_every_other_key() {
    let kernel = create_test_kernel().await;
    let office = office_with_member(&kernel, "lead", vec![Permission::UpdateNodeSettings]).await;

    let answer = process_command_with_user(
        &kernel,
        &set_tabs(&office, json!({"app_tabs": ["com.acme.kanban"]}), None),
        "lead",
    )
    .await
    .unwrap();

    assert!(
        matches!(answer, WorkspaceProtocolResponse::Node(_)),
        "{answer:?}"
    );
    let stored = stored_metadata(&kernel, &office).await;
    assert_eq!(stored["app_tabs"], json!(["com.acme.kanban"]));
    assert_eq!(stored["keep"], json!("me"));
}

#[tokio::test]
async fn changing_tabs_and_the_page_together_needs_both_permissions() {
    let kernel = create_test_kernel().await;
    let office = office_with_member(&kernel, "lead2", vec![Permission::UpdateNodeSettings]).await;

    let answer = process_command_with_user(
        &kernel,
        &set_tabs(&office, json!({"app_tabs": []}), Some("# rewritten")),
        "lead2",
    )
    .await
    .unwrap();

    assert!(matches!(answer, WorkspaceProtocolResponse::Error(ref e) if e.contains("EditMdx")));
    assert!(stored_metadata(&kernel, &office)
        .await
        .get("app_tabs")
        .is_none());
}

#[tokio::test]
async fn a_list_the_rules_refuse_is_not_stored() {
    let kernel = create_test_kernel().await;
    let office = office_with_member(&kernel, "lead3", vec![Permission::UpdateNodeSettings]).await;
    let nine: Vec<String> = (0..9).map(|i| format!("com.acme.app{i}")).collect();

    let answer = process_command_with_user(
        &kernel,
        &set_tabs(&office, json!({ "app_tabs": nine }), None),
        "lead3",
    )
    .await
    .unwrap();

    assert!(
        matches!(answer, WorkspaceProtocolResponse::Error(_)),
        "{answer:?}"
    );
    assert!(stored_metadata(&kernel, &office)
        .await
        .get("app_tabs")
        .is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_tab_change_is_announced_to_everyone_on_the_node() {
    let kernel = create_test_kernel().await;
    let office = office_with_member(&kernel, "lead4", vec![Permission::UpdateNodeSettings]).await;
    let mut rx = kernel.subscribe_broadcast();

    process_command_with_user(
        &kernel,
        &set_tabs(&office, json!({"app_tabs": ["com.acme.kanban"]}), None),
        "lead4",
    )
    .await
    .unwrap();

    let mut announced = false;
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        if let WorkspaceProtocolResponse::Node(node) = msg.response {
            announced |= node.id == office
                && serde_json::from_slice::<Value>(&node.metadata).unwrap()["app_tabs"]
                    == json!(["com.acme.kanban"]);
        }
    }
    assert!(
        announced,
        "other members' panes would keep the old tabs until a reload"
    );
}
