//! Files shared in a node's chat, driven through the real command processor against the room
//! `group_channel_test_utils` writes (and a second one beside it), with the shipped file size and
//! a storage entitlement the test sets, answered through the same `limit::storage_quota` a
//! hosted tenant's answer goes through.

pub use crate::chat_document_test_utils::{
    GUEST, GUEST_CID, MEMBER, MEMBER_CID, OUTSIDER, OUTSIDER_CID,
};
pub use crate::group_channel_test_utils::{
    add_room_with_chat, add_user_with_role, ask, CHANNEL, ROOM_ID,
};
use crate::member_test_utils::GateKernel;
use crate::workspace_test_utils::create_configured_test_kernel;
use async_trait::async_trait;
use citadel_sdk::prelude::{SqlHost, SqlRow, SqlStatement, StorageQuota};
use citadel_workspace_server_kernel::kernel::apps::storage_entitlement::StorageEntitlement;
use citadel_workspace_types::chat_attachments::{
    ChatAttachmentRefusal, ChatAttachmentsRequest, ChatAttachmentsResponse,
    CHAT_ATTACHMENT_CHUNK_BYTES,
};
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{
    GroupMessageType, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// A second chat room, beside `ROOM_ID`, with the same members.
pub const OTHER_ROOM: &str = "other-room-under-test";
pub const OTHER_CHANNEL: &str = "other-chat-channel-under-test";
/// A second member of both rooms, who may send.
pub const SECOND: &str = "room_second";
pub const SECOND_CID: u64 = 404;

/// The workspace's storage as app storage and chat files ask it.
struct PlanHost(StorageQuota);

#[async_trait]
impl SqlHost for PlanHost {
    async fn execute(&self, _: Vec<SqlStatement>) -> Result<Vec<Vec<SqlRow>>, String> {
        Err("chat files run no SQL through the host".to_string())
    }

    fn storage_quota(&self) -> Result<StorageQuota, String> {
        Ok(self.0)
    }
}

/// The shipped kernel.toml's chat file size, so a test cannot pass under a size no server runs.
pub fn shipped_max_bytes() -> u64 {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../docker/workspace-server/kernel.toml");
    let raw = std::fs::read_to_string(&path).expect("the shipped kernel.toml");
    let config: citadel_workspace_server_kernel::config::ServerConfig =
        toml::from_str(&raw).expect("the shipped kernel.toml parses");
    citadel_workspace_server_kernel::resolve_chat_attachment_max_bytes(&config).expect("set")
}

/// Two chat rooms, the member, a second member and the guest in both, and an outsider in
/// neither, with `quota` for the workspace's storage.
pub async fn rooms(quota: StorageQuota) -> Arc<GateKernel> {
    let kernel = create_configured_test_kernel(|kernel| {
        kernel.set_chat_attachment_max_bytes(Some(shipped_max_bytes()));
        kernel.set_storage_entitlement(Some(StorageEntitlement::Host(Arc::new(PlanHost(quota)))));
    })
    .await;
    for (who, role) in [
        (MEMBER, UserRole::Member),
        (SECOND, UserRole::Member),
        (GUEST, UserRole::Guest),
        (OUTSIDER, UserRole::Member),
    ] {
        add_user_with_role(&kernel, who, role).await;
    }
    add_room_with_chat(&kernel, &[MEMBER, SECOND, GUEST]).await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut other = backend
        .get_all_nodes()
        .await
        .expect("nodes")
        .remove(ROOM_ID)
        .expect("the room");
    other.id = OTHER_ROOM.to_string();
    other.chat_channel_id = Some(OTHER_CHANNEL.to_string());
    backend
        .insert_node(OTHER_ROOM.to_string(), other)
        .await
        .expect("insert");
    kernel
}

pub fn id_of(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// `len` bytes that differ by `seed`.
pub fn file(len: usize, seed: u8) -> Vec<u8> {
    (0..len)
        .map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed))
        .collect()
}

pub async fn chunk(
    kernel: &GateKernel,
    who: (&str, u64),
    node: &str,
    id: &str,
    whole: &[u8],
    index: u32,
) -> ChatAttachmentsResponse {
    let full = CHAT_ATTACHMENT_CHUNK_BYTES as usize;
    let total = whole.len().div_ceil(full) as u32;
    let bytes =
        whole[index as usize * full..((index as usize + 1) * full).min(whole.len())].to_vec();
    let request = ChatAttachmentsRequest::UploadChunk {
        node_id: node.to_string(),
        sha256: id.to_string(),
        size_bytes: whole.len() as u64,
        index,
        total_chunks: total,
        bytes,
    };
    answer(
        ask(
            kernel,
            who.0,
            who.1,
            WorkspaceProtocolRequest::ChatAttachments(request),
        )
        .await,
    )
}

/// Uploads `whole` as `who` at `node`, every chunk, answering the last chunk's answer.
pub async fn upload(
    kernel: &GateKernel,
    who: (&str, u64),
    node: &str,
    whole: &[u8],
) -> ChatAttachmentsResponse {
    let id = id_of(whole);
    let total = whole.len().div_ceil(CHAT_ATTACHMENT_CHUNK_BYTES as usize) as u32;
    let mut last = None;
    for index in 0..total {
        last = Some(chunk(kernel, who, node, &id, whole, index).await);
    }
    last.expect("a file has a chunk")
}

pub fn is_stored(response: &ChatAttachmentsResponse) -> bool {
    matches!(
        response,
        ChatAttachmentsResponse::ChunkStored { stored: true, .. }
    )
}

pub fn refusal(response: ChatAttachmentsResponse) -> ChatAttachmentRefusal {
    match response {
        ChatAttachmentsResponse::Refused { refusal, .. } => refusal,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// Reads every chunk of `id` at `node` as `who`: the bytes, or the first refusal.
pub async fn read(
    kernel: &GateKernel,
    who: (&str, u64),
    node: &str,
    id: &str,
) -> Result<Vec<u8>, ChatAttachmentRefusal> {
    let mut bytes = Vec::new();
    let mut index = 0;
    loop {
        let request = ChatAttachmentsRequest::ReadChunk {
            node_id: node.to_string(),
            attachment_id: id.to_string(),
            index,
        };
        match answer(
            ask(
                kernel,
                who.0,
                who.1,
                WorkspaceProtocolRequest::ChatAttachments(request),
            )
            .await,
        ) {
            ChatAttachmentsResponse::Chunk {
                bytes: part,
                total_chunks,
                ..
            } => {
                bytes.extend(part);
                index += 1;
                if index == total_chunks {
                    return Ok(bytes);
                }
            }
            ChatAttachmentsResponse::Refused { refusal, .. } => return Err(refusal),
            other => panic!("{other:?}"),
        }
    }
}

/// Shares `whole` (by its id) in `channel` as `who`: the stored message's id, or the refusal.
pub async fn share(
    kernel: &GateKernel,
    who: (&str, u64),
    channel: &str,
    whole: &[u8],
) -> Result<String, String> {
    let request = WorkspaceProtocolRequest::SendGroupMessage {
        group_id: channel.to_string(),
        message_type: GroupMessageType::FileShare {
            attachment_id: id_of(whole),
            name: "notes.txt".to_string(),
            size_bytes: whole.len() as u64,
            mime: "text/plain".to_string(),
        },
        content: String::new(),
        reply_to: None,
        mentions: None,
    };
    match ask(kernel, who.0, who.1, request).await {
        WorkspaceProtocolResponse::GroupMessageNotification { message, .. } => Ok(message.id),
        WorkspaceProtocolResponse::Error(why) => Err(why),
        other => panic!("{other:?}"),
    }
}

pub async fn delete_message(kernel: &GateKernel, who: (&str, u64), message_id: &str) {
    let request = WorkspaceProtocolRequest::DeleteGroupMessage {
        group_id: CHANNEL.to_string(),
        message_id: message_id.to_string(),
    };
    match ask(kernel, who.0, who.1, request).await {
        WorkspaceProtocolResponse::GroupMessageDeleted { .. } => {}
        other => panic!("the delete was refused: {other:?}"),
    }
}

fn answer(response: WorkspaceProtocolResponse) -> ChatAttachmentsResponse {
    match response {
        WorkspaceProtocolResponse::ChatAttachments(answer) => answer,
        other => panic!("expected a chat attachments answer, got {other:?}"),
    }
}
