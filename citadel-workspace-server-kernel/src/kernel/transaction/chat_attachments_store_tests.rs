//! A node's chat files when a write stops part way (`chat_attachments_store`,
//! `chat_attachment_sweep`), on the real kernel over its in-memory backend: the sweep reclaims
//! bytes a store left without an index entry, and a share whose message failed to store is
//! taken back.

use super::group_message_pages::index_key;
use crate::kernel::apps::test_support::{workspace, Kernel};
use crate::kernel::chat_attachment_sweep::{sweep_batch, SWEEP_BATCH};
use crate::kernel::chat_attachments::{root_of, ChatAttachmentLimits};
use crate::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_app_signature::sha256;
use citadel_workspace_types::chat_attachments::{
    ChatAttachmentRefusal, ChatAttachmentsRequest, ChatAttachmentsResponse,
};
use citadel_workspace_types::{
    GroupMessageType, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use std::collections::BTreeSet;

const NODE: &str = "room";
const CHANNEL: &str = "room-chat";
const NOW: u64 = 10_000_000;

/// `workspace()`, with `room`'s chat on and alice and bob its members.
async fn chat_room() -> Kernel {
    let mut kernel = workspace().await;
    // Shipped-sized limits; these tests stay far inside both.
    kernel.set_chat_attachment_limits(Some(ChatAttachmentLimits {
        max_bytes: 25 * 1024 * 1024,
        max_files_per_node: 2048,
    }));
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut room = backend.get_node(NODE).await.expect("read").expect("room");
    room.chat_enabled = true;
    room.chat_channel_id = Some(CHANNEL.to_string());
    room.members = vec!["alice".to_string(), "bob".to_string()];
    backend
        .insert_node(NODE.to_string(), room)
        .await
        .expect("save");
    kernel
}

async fn ask(
    kernel: &Kernel,
    who: &str,
    request: WorkspaceProtocolRequest,
) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, who)
        .await
        .expect("dispatch")
}

fn chat(response: WorkspaceProtocolResponse) -> ChatAttachmentsResponse {
    match response {
        WorkspaceProtocolResponse::ChatAttachments(answer) => answer,
        other => panic!("{other:?}"),
    }
}

/// Uploads `bytes` (one chunk) to `room` as `who`, answering its id.
async fn upload(kernel: &Kernel, who: &str, bytes: &[u8]) -> String {
    let id = hex::encode(sha256(bytes));
    let request = ChatAttachmentsRequest::UploadChunk {
        node_id: NODE.to_string(),
        sha256: id.clone(),
        size_bytes: bytes.len() as u64,
        index: 0,
        total_chunks: 1,
        bytes: bytes.to_vec(),
    };
    let answer = chat(
        ask(
            kernel,
            who,
            WorkspaceProtocolRequest::ChatAttachments(request),
        )
        .await,
    );
    assert!(
        matches!(
            answer,
            ChatAttachmentsResponse::ChunkStored { stored: true, .. }
        ),
        "{answer:?}"
    );
    id
}

async fn readable(kernel: &Kernel, who: &str, id: &str) -> bool {
    let request = ChatAttachmentsRequest::ReadChunk {
        node_id: NODE.to_string(),
        attachment_id: id.to_string(),
        index: 0,
    };
    match chat(
        ask(
            kernel,
            who,
            WorkspaceProtocolRequest::ChatAttachments(request),
        )
        .await,
    ) {
        ChatAttachmentsResponse::Chunk { .. } => true,
        ChatAttachmentsResponse::Refused { refusal, .. } => {
            assert_eq!(refusal, ChatAttachmentRefusal::Denied);
            false
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn a_share_whose_message_failed_to_store_is_taken_back() {
    let kernel = chat_room().await;
    let bytes = b"the minutes".to_vec();
    let id = upload(&kernel, "alice", &bytes).await;
    // The channel's message index is unreadable, so storing any message fails after the claim.
    let backend = &kernel.domain_operations.backend_tx_manager;
    backend
        .backend_save(&index_key(CHANNEL), &"not a count")
        .await
        .expect("plant");
    let send = WorkspaceProtocolRequest::SendGroupMessage {
        group_id: CHANNEL.to_string(),
        message_type: GroupMessageType::FileShare {
            attachment_id: id.clone(),
            name: "minutes.txt".to_string(),
            size_bytes: bytes.len() as u64,
            mime: "text/plain".to_string(),
        },
        content: String::new(),
        reply_to: None,
        mentions: None,
    };
    let sent = ask(&kernel, "alice", send).await;
    assert!(
        matches!(sent, WorkspaceProtocolResponse::Error(_)),
        "{sent:?}"
    );
    assert!(
        !readable(&kernel, "bob", &id).await,
        "shared by a message nobody stored"
    );
    assert!(
        readable(&kernel, "alice", &id).await,
        "the upload itself stays its uploader's"
    );
}

#[tokio::test]
async fn the_sweep_reclaims_bytes_a_store_left_without_an_index_entry() {
    let kernel = chat_room().await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let bytes = b"stopped between the ledger and the index".to_vec();
    let id = hex::encode(sha256(&bytes));
    // What `keep` leaves when it stops after the bytes and before the index.
    backend
        .store_chat_attachment(NODE, &id, &bytes)
        .await
        .expect("store");
    assert!(backend
        .app_ledger(&root_of(NODE))
        .await
        .expect("ledger")
        .blobs
        .contains_key(&id));

    assert_eq!(
        kernel
            .sweep_chat_attachments(NOW, SWEEP_BATCH)
            .await
            .expect("swept"),
        0
    );
    assert!(backend
        .app_ledger(&root_of(NODE))
        .await
        .expect("ledger")
        .is_empty());
    let left: Vec<String> = backend
        .stored_keys()
        .into_iter()
        .filter(|k| k.contains(&id))
        .collect();
    assert!(left.is_empty(), "orphaned: {left:?}");
    assert!(
        backend
            .chat_attachment_nodes()
            .await
            .expect("nodes")
            .is_empty(),
        "a node holding nothing is visited no more"
    );
}

#[test]
fn a_pass_takes_the_nodes_after_the_last_one_and_says_how_many_remain() {
    let nodes: BTreeSet<String> = ["a", "b", "c"].map(String::from).into();
    assert_eq!(
        sweep_batch(&nodes, None, 2),
        (vec!["a".into(), "b".into()], 1)
    );
    assert_eq!(sweep_batch(&nodes, Some("b"), 2), (vec!["c".into()], 0));
    assert_eq!(sweep_batch(&nodes, Some("gone"), 2), (vec![], 0));
    assert_eq!(sweep_batch(&BTreeSet::new(), None, 2), (vec![], 0));
}
