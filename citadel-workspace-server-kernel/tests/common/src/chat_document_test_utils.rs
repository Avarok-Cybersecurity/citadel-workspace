//! Documents shared in a node's chat, driven through the real command processor against the room
//! `group_channel_test_utils` writes, on a kernel with the shipped documents limits.

pub use crate::documents_test_utils::{documents_kernel, drain, Replica};
pub use crate::group_channel_test_utils::{
    add_room_with_chat, add_user_with_role, CHANNEL, ROOM_ID,
};
use crate::member_test_utils::GateKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use citadel_workspace_types::chat_documents::{ChatDocumentsRequest, ChatDocumentsResponse};
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::sync::Arc;

/// Two ids as the chat's `newChatDocumentId()` makes them.
pub const DOC_A: &str = "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b";
pub const DOC_B: &str = "cdoc-0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

pub const MEMBER: &str = "room_member";
pub const MEMBER_CID: u64 = 101;
/// In the room, with `ViewContent` and nothing else.
pub const GUEST: &str = "room_guest";
pub const GUEST_CID: u64 = 202;
pub const OUTSIDER: &str = "not_in_this_room";
pub const OUTSIDER_CID: u64 = 303;

/// A documents kernel with the room, a member and a guest in it, and an account outside it.
pub async fn room() -> Arc<GateKernel> {
    let kernel = documents_kernel().await;
    add_user_with_role(&kernel, MEMBER, UserRole::Member).await;
    add_user_with_role(&kernel, GUEST, UserRole::Guest).await;
    add_user_with_role(&kernel, OUTSIDER, UserRole::Member).await;
    add_room_with_chat(&kernel, &[MEMBER, GUEST]).await;
    kernel
}

pub async fn ask_chat(
    kernel: &GateKernel,
    who: &str,
    cid: u64,
    chat_doc: &str,
    request: DocumentsRequest,
) -> WorkspaceProtocolResponse {
    let request = WorkspaceProtocolRequest::ChatDocuments(ChatDocumentsRequest {
        chat_doc: chat_doc.to_string(),
        request,
    });
    process_command_with_user_and_cid(kernel, &request, who, Some(cid))
        .await
        .expect("dispatch")
}

/// The answer about `chat_doc`, or a panic naming what came instead.
pub fn chat_answer(response: WorkspaceProtocolResponse, chat_doc: &str) -> DocumentsResponse {
    match response {
        WorkspaceProtocolResponse::ChatDocuments(ChatDocumentsResponse {
            chat_doc: named,
            answer,
        }) if named == chat_doc => answer,
        other => panic!("expected an answer about {chat_doc}, got {other:?}"),
    }
}

pub fn append_of(update: &[u8]) -> DocumentsRequest {
    DocumentsRequest::Append {
        node_id: ROOM_ID.to_string(),
        doc_version: 1,
        update: update.to_vec(),
        client_seq: 0,
    }
}

pub fn pull_all() -> DocumentsRequest {
    DocumentsRequest::Pull {
        node_id: ROOM_ID.to_string(),
        since_seq: 0,
    }
}

pub async fn chat_append(kernel: &GateKernel, chat_doc: &str, update: &[u8]) -> u64 {
    let answer = ask_chat(kernel, MEMBER, MEMBER_CID, chat_doc, append_of(update)).await;
    match chat_answer(answer, chat_doc) {
        DocumentsResponse::Appended { seq, .. } => seq,
        other => panic!("the chat document's append was not stored: {other:?}"),
    }
}

/// Every update `chat_doc`'s log holds, as `MEMBER` reads it.
pub async fn chat_updates(kernel: &GateKernel, chat_doc: &str) -> Vec<Vec<u8>> {
    let answer = ask_chat(kernel, MEMBER, MEMBER_CID, chat_doc, pull_all()).await;
    match chat_answer(answer, chat_doc) {
        DocumentsResponse::Updates { updates, .. } => {
            updates.into_iter().map(|u| u.update).collect()
        }
        other => panic!("the chat document's pull was refused: {other:?}"),
    }
}

/// Whether `answer` is the channel gate's refusal for `chat_doc`, naming `permission`.
pub fn denied(
    answer: WorkspaceProtocolResponse,
    chat_doc: &str,
    permission: citadel_workspace_types::structs::Permission,
) -> bool {
    matches!(
        chat_answer(answer, chat_doc),
        DocumentsResponse::Refused(DocumentRefusal::ChatDocumentDenied { permission: named, .. })
            if named == permission
    )
}
