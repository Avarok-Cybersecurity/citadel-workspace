//! A member's group message is text or Markdown, never a System notice.
//!
//! SendGroupMessage took `message_type` from the client and stored it as sent, so any member
//! could post `System` -- rendered as the workspace's own notice ("X joined", "settings
//! changed"), in the server's voice. System notices are the server's to write. Markdown now
//! reaches every group chat (owner, 2026-09-27), so the one type a client may not choose is
//! refused here.
//!
//! No mocks: the real command processor and a real office with its chat on.
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::NodeEntityType;
use citadel_workspace_types::{
    GroupMessageType, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::member_test_utils::GateKernel as Kernel;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

async fn send(kernel: &Kernel, request: WorkspaceProtocolRequest) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatch failed")
}

async fn office_channel(kernel: &Kernel) -> String {
    let office = match send(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Ops".to_string(),
            description: String::new(),
        },
    )
    .await
    {
        WorkspaceProtocolResponse::Node(n) => n,
        other => panic!("create failed: {other:?}"),
    };
    let enabled = send(
        kernel,
        WorkspaceProtocolRequest::UpdateNode {
            node_id: office.id.clone(),
            name: None,
            description: None,
            mdx_content: None,
            rules: None,
            chat_enabled: Some(true),
            is_default: None,
        },
    )
    .await;
    match enabled {
        WorkspaceProtocolResponse::Node(n) => n.chat_channel_id.expect("chat on has a channel"),
        other => panic!("enabling chat failed: {other:?}"),
    }
}

fn message(group_id: &str, message_type: GroupMessageType) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::SendGroupMessage {
        group_id: group_id.to_string(),
        message_type,
        content: "Ops has been archived".to_string(),
        reply_to: None,
        mentions: None,
        document_id: None,
        document_title: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_system_notice_from_a_member_is_refused() {
    let kernel = create_test_kernel().await;
    let channel = office_channel(&kernel).await;
    let response = send(&kernel, message(&channel, GroupMessageType::System)).await;
    assert!(
        matches!(&response, WorkspaceProtocolResponse::Error(e) if e.contains("System")),
        "a member posted in the server's voice: {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn text_and_markdown_are_posted_as_sent() {
    let kernel = create_test_kernel().await;
    let channel = office_channel(&kernel).await;
    for kind in [GroupMessageType::Text, GroupMessageType::Markdown] {
        match send(&kernel, message(&channel, kind.clone())).await {
            WorkspaceProtocolResponse::GroupMessageNotification { message, .. } => {
                assert_eq!(message.message_type, kind)
            }
            other => panic!("{kind:?} was not posted: {other:?}"),
        }
    }
}
