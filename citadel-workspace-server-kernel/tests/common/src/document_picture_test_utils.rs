//! Pictures of a page's and a chat document's documents, driven through the real command processor
//! against the rooms `chat_attachment_test_utils` writes, under the shipped chat file limits the
//! picture limits are derived from and a storage entitlement the test sets.

pub use crate::chat_attachment_test_utils::{
    add_room_with_chat, ask, file, rooms, rooms_with, shipped_limits, GUEST, GUEST_CID, MEMBER,
    MEMBER_CID, OTHER_ROOM, OUTSIDER, OUTSIDER_CID, ROOM_ID, SECOND, SECOND_CID,
};
pub use crate::chat_document_test_utils::{DOC_A, DOC_B};
use crate::member_test_utils::GateKernel;
use citadel_workspace_types::chat_attachments::CHAT_ATTACHMENT_CHUNK_BYTES;
use citadel_workspace_types::document_pictures::{
    DocumentPictureRefusal, DocumentPicturesRequest, DocumentPicturesResponse, PictureDocument,
};
use citadel_workspace_types::structs::Permission;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use sha2::{Digest, Sha256};

pub fn page(node: &str) -> PictureDocument {
    PictureDocument {
        node_id: node.to_string(),
        chat_doc: None,
    }
}

pub fn chat_doc(node: &str, chat_doc: &str) -> PictureDocument {
    PictureDocument {
        node_id: node.to_string(),
        chat_doc: Some(chat_doc.to_string()),
    }
}

/// The content id of `bytes`: `sha256-` and their lowercase hex SHA-256.
pub fn content_id(bytes: &[u8]) -> String {
    format!("sha256-{}", hex::encode(Sha256::digest(bytes)))
}

/// Grants `who` `permission` on `node` directly, as an admin grants document editing; the Member
/// role reads every node it is a member of and edits none.
pub async fn grant(kernel: &GateKernel, who: &str, node: &str, permission: Permission) {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut user = backend
        .get_user(who)
        .await
        .expect("read user")
        .expect("the user exists");
    user.permissions
        .entry(node.to_string())
        .or_default()
        .insert(permission);
    backend
        .insert_user(who.to_string(), user)
        .await
        .expect("save user");
}

pub async fn send(
    kernel: &GateKernel,
    who: (&str, u64),
    request: DocumentPicturesRequest,
) -> DocumentPicturesResponse {
    let request = WorkspaceProtocolRequest::DocumentPictures(request);
    match ask(kernel, who.0, who.1, request).await {
        WorkspaceProtocolResponse::DocumentPictures(answer) => answer,
        other => panic!("expected a document pictures answer, got {other:?}"),
    }
}

/// Uploads chunk `index` of `whole` under `id` to `doc` as `who`.
pub async fn chunk(
    kernel: &GateKernel,
    who: (&str, u64),
    doc: &PictureDocument,
    id: &str,
    whole: &[u8],
    index: u32,
) -> DocumentPicturesResponse {
    let full = CHAT_ATTACHMENT_CHUNK_BYTES as usize;
    let start = index as usize * full;
    let request = DocumentPicturesRequest::UploadChunk {
        doc: doc.clone(),
        content_id: id.to_string(),
        size_bytes: whole.len() as u64,
        index,
        total_chunks: whole.len().div_ceil(full) as u32,
        bytes: whole[start..(start + full).min(whole.len())].to_vec(),
    };
    send(kernel, who, request).await
}

/// Uploads `whole` under its content id to `doc` as `who`, every chunk; the last chunk's answer,
/// or the first refusal.
pub async fn upload(
    kernel: &GateKernel,
    who: (&str, u64),
    doc: &PictureDocument,
    whole: &[u8],
) -> DocumentPicturesResponse {
    let id = content_id(whole);
    let total = whole.len().div_ceil(CHAT_ATTACHMENT_CHUNK_BYTES as usize) as u32;
    let mut last = None;
    for index in 0..total {
        let answer = chunk(kernel, who, doc, &id, whole, index).await;
        if matches!(answer, DocumentPicturesResponse::Refused { .. }) {
            return answer;
        }
        last = Some(answer);
    }
    last.expect("a picture has a chunk")
}

pub fn is_stored(response: &DocumentPicturesResponse) -> bool {
    matches!(
        response,
        DocumentPicturesResponse::ChunkStored { stored: true, .. }
    )
}

pub fn refusal(response: DocumentPicturesResponse) -> DocumentPictureRefusal {
    match response {
        DocumentPicturesResponse::Refused { refusal, .. } => refusal,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// Reads every chunk of `id` of `doc` as `who`: the bytes, or the first refusal.
pub async fn read(
    kernel: &GateKernel,
    who: (&str, u64),
    doc: &PictureDocument,
    id: &str,
) -> Result<Vec<u8>, DocumentPictureRefusal> {
    let mut bytes = Vec::new();
    let mut index = 0;
    loop {
        let request = DocumentPicturesRequest::ReadChunk {
            doc: doc.clone(),
            content_id: id.to_string(),
            index,
        };
        match send(kernel, who, request).await {
            DocumentPicturesResponse::Chunk {
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
            DocumentPicturesResponse::Refused { refusal, .. } => return Err(refusal),
            other => panic!("{other:?}"),
        }
    }
}
