//! A room with a chat channel and named people in it, written straight to the backend so each
//! test states the shape it depends on.

use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, User, UserRole,
};
use citadel_workspace_types::{
    GroupMessageType, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use std::collections::HashMap;

pub type Kernel = AsyncWorkspaceServerKernel<MonoRatchet>;

pub const CHANNEL: &str = "chat-channel-under-test";
pub const ROOM_ID: &str = "room-under-test";

pub async fn add_user_with_role(kernel: &Kernel, id: &str, role: UserRole) {
    let user = User {
        id: id.to_string(),
        name: id.to_string(),
        role,
        workspace_roles: Default::default(),
        permissions: HashMap::new(),
        metadata: Default::default(),
    };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(id.to_string(), user)
        .await
        .expect("insert user");
}

/// A chat-enabled room under the workspace whose members are `members`.
pub async fn add_room_with_chat(kernel: &Kernel, members: &[&str]) {
    let node = DomainNode {
        id: ROOM_ID.to_string(),
        parent_id: Some(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string()),
        entity_type: NodeEntityType::Child("Room".to_string()),
        depth: 1,
        name: "Room".to_string(),
        description: String::new(),
        owner_id: members[0].to_string(),
        members: members.iter().map(|m| m.to_string()).collect(),
        children: vec![],
        mdx_content: String::new(),
        mdx_content_hash: None,
        rules: None,
        chat_enabled: true,
        chat_channel_id: Some(CHANNEL.to_string()),
        default_permissions: DomainPermissions::default(),
        metadata: Default::default(),
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_node(ROOM_ID.to_string(), node)
        .await
        .expect("insert node");
}

pub async fn ask(
    kernel: &Kernel,
    who: &str,
    cid: u64,
    request: WorkspaceProtocolRequest,
) -> WorkspaceProtocolResponse {
    process_command_with_user_and_cid(kernel, &request, who, Some(cid))
        .await
        .expect("dispatch")
}

/// Posts "hello" as `who` and answers the stored message's id.
pub async fn post(kernel: &Kernel, who: &str, cid: u64) -> String {
    let request = WorkspaceProtocolRequest::SendGroupMessage {
        group_id: CHANNEL.to_string(),
        message_type: GroupMessageType::Text,
        content: "hello".to_string(),
        reply_to: None,
        mentions: None,
    };
    match ask(kernel, who, cid, request).await {
        WorkspaceProtocolResponse::GroupMessageNotification { message, .. } => message.id,
        other => panic!("the post was refused: {other:?}"),
    }
}

pub fn is_denied(response: &WorkspaceProtocolResponse) -> bool {
    matches!(response, WorkspaceProtocolResponse::Error(e) if e.contains("Permission denied"))
}

pub fn history() -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::GetGroupMessages {
        group_id: CHANNEL.to_string(),
        before_timestamp: None,
        limit: None,
    }
}
