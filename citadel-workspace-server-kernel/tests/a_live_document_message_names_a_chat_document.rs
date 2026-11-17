//! A message sharing a live document in a node channel names it by the chat's own id, and the
//! channel keeps that id with the message for every later reader.

use citadel_workspace_server_kernel::kernel::command_processor::group_message_shape::NOT_A_CHAT_DOCUMENT;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{
    GroupMessageType, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::group_channel_test_utils::*;
use common::workspace_test_utils::create_test_kernel;

mod common {
    pub use ::common::*;
}

const MEMBER: &str = "room_member";
const DOC: &str = "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b";

fn share(document_id: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::SendGroupMessage {
        group_id: CHANNEL.to_string(),
        message_type: GroupMessageType::LiveDocument {
            document_id: document_id.to_string(),
        },
        content: "Agenda".to_string(),
        reply_to: None,
        mentions: None,
    }
}

async fn room() -> std::sync::Arc<Kernel> {
    let kernel = create_test_kernel().await;
    add_user_with_role(&kernel, MEMBER, UserRole::Member).await;
    add_room_with_chat(&kernel, &[MEMBER]).await;
    kernel
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_share_is_kept_with_its_document_id_and_title() {
    let kernel = room().await;
    ask(&kernel, MEMBER, 101, share(DOC)).await;
    let WorkspaceProtocolResponse::GroupMessages { messages, .. } =
        ask(&kernel, MEMBER, 101, history()).await
    else {
        panic!("history was refused");
    };
    let shared = messages.last().expect("the share is in the history");
    assert_eq!(
        (&shared.message_type, shared.content.as_str()),
        (
            &GroupMessageType::LiveDocument {
                document_id: DOC.to_string()
            },
            "Agenda"
        )
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_share_naming_anything_else_is_refused_and_not_stored() {
    let kernel = room().await;
    let answer = ask(&kernel, MEMBER, 101, share("../not-a-document")).await;
    assert!(
        matches!(&answer, WorkspaceProtocolResponse::Error(e) if e == NOT_A_CHAT_DOCUMENT),
        "{answer:?}"
    );
    let WorkspaceProtocolResponse::GroupMessages { messages, .. } =
        ask(&kernel, MEMBER, 101, history()).await
    else {
        panic!("history was refused");
    };
    assert!(messages.is_empty(), "the refused share was stored");
}
