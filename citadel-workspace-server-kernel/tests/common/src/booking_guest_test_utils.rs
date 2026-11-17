//! A booking guest's world, shared by the booking-guest specs: nodes made by the admin, accounts
//! whose role holds nothing (as a workspace whose default role gives joiners nothing makes them),
//! booking grants, and whether someone can view a node.

use crate::member_test_utils::{member_holding, seed_role, GateKernel};
use crate::workspace_test_utils::TEST_ADMIN_USER_ID;
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::secure_links::LinkGrant;
use citadel_workspace_types::structs::{NodeEntityType, Permission};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

/// An office under the root, made by the admin.
pub async fn node(kernel: &GateKernel, name: &str) -> String {
    let request = WorkspaceProtocolRequest::CreateNode {
        parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        name: name.to_string(),
        description: String::new(),
        metadata: None,
    };
    match process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatched")
    {
        WorkspaceProtocolResponse::Node(node) => node.id,
        other => panic!("no node: {other:?}"),
    }
}

/// Accounts the workspace knows whose role holds nothing: not members.
pub async fn outsiders(kernel: &GateKernel, ids: &[&str]) {
    seed_role(kernel, "nothing", 10, &[]).await;
    for id in ids {
        member_holding(kernel, id, "nothing").await;
    }
}

pub async fn views(kernel: &GateKernel, user: &str, node: &str) -> bool {
    kernel
        .domain_operations
        .check_entity_permission(user, node, Permission::ViewContent)
        .await
        .expect("checked")
}

pub fn booking(node: &str, max_guests: u8) -> Vec<LinkGrant> {
    vec![LinkGrant::BookingGuest {
        node_id: node.to_string(),
        page: "admin".to_string(),
        max_guests,
    }]
}

pub fn target(node: &str) -> String {
    format!("/workspace?nodeId={node}")
}
