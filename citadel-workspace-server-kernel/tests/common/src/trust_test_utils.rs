//! Driving the messaging trust policy through the real command processor, over one tree:
//!
//! workspace-root (wes) ─┬─ eng (eve) ── backend (bob)
//!                       └─ sales (sam)
//!
//! Everyone is also a workspace member, as every connecting account is.

use crate::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use crate::workspace_test_utils::TEST_ADMIN_USER_ID;
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::messaging_trust::{
    MessagingTrustPolicy as Policy, MessagingTrustRequest as Req, MessagingTrustResponse as Res,
    MessagingTrustSettings, WORKSPACE_ROOT_ID as ROOT,
};
use citadel_workspace_types::structs::{NodeEntityType, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

pub struct Tree {
    pub eng: String,
    pub backend: String,
    pub sales: String,
}

pub async fn node(kernel: &Kernel, parent: &str, name: &str) -> String {
    kernel
        .domain_operations
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(parent),
            &NodeEntityType::Child("Office".to_string()),
            name,
            "",
        )
        .await
        .expect("an admin may create the node")
        .id
}

pub async fn member(kernel: &Kernel, id: &str, on: Option<&str>) {
    insert_user_with_role(kernel, id, UserRole::Member).await;
    join_root(kernel, id).await;
    if let Some(node_id) = on {
        kernel
            .domain_operations
            .add_user_to_domain(TEST_ADMIN_USER_ID, id, node_id, UserRole::Member)
            .await
            .expect("an admin may add a member to a node");
    }
}

pub async fn tree(kernel: &Kernel) -> Tree {
    let eng = node(kernel, ROOT, "Engineering").await;
    let backend = node(kernel, &eng, "Backend").await;
    let sales = node(kernel, ROOT, "Sales").await;
    member(kernel, "wes", None).await;
    member(kernel, "eve", Some(&eng)).await;
    member(kernel, "bob", Some(&backend)).await;
    member(kernel, "sam", Some(&sales)).await;
    Tree {
        eng,
        backend,
        sales,
    }
}

pub fn on(node_id: &str) -> Policy {
    Policy::NodeLevelTrusted {
        node_id: node_id.to_string(),
    }
}

pub async fn send(kernel: &Kernel, user: &str, request: Req) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &WorkspaceProtocolRequest::MessagingTrust(request), user)
        .await
        .expect("dispatch failed")
}

pub async fn settings_after(kernel: &Kernel, user: &str, request: Req) -> MessagingTrustSettings {
    match send(kernel, user, request).await {
        WorkspaceProtocolResponse::MessagingTrust(Res::Settings(settings)) => settings,
        other => panic!("expected the settings, got {other:?}"),
    }
}

pub async fn refusal(kernel: &Kernel, user: &str, request: Req) -> String {
    match send(kernel, user, request).await {
        WorkspaceProtocolResponse::Error(e) => e,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// (caller trusts peer, peer trusts caller)
pub async fn check(kernel: &Kernel, caller: &str, peer: &str) -> (bool, bool) {
    let request = Req::CheckMessagingTrust {
        peer_username: peer.to_string(),
    };
    match send(kernel, caller, request).await {
        WorkspaceProtocolResponse::MessagingTrust(Res::PeerTrust {
            peer_username,
            trusted,
            peer_trusts_caller,
        }) => {
            assert_eq!(peer_username, peer, "the answer names whom it is about");
            (trusted, peer_trusts_caller)
        }
        other => panic!("expected PeerTrust, got {other:?}"),
    }
}

pub async fn set_workspace(kernel: &Kernel, policy: Policy) -> MessagingTrustSettings {
    let request = Req::SetWorkspaceMessagingTrust { policy };
    settings_after(kernel, TEST_ADMIN_USER_ID, request).await
}

pub fn set_mine(policy: Option<Policy>) -> Req {
    Req::SetMyMessagingTrust { policy }
}
