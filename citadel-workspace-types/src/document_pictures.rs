//! Pictures inserted into a Citadel Docs document kept on the workspace server: a node's page, or
//! a document shared in a node's chat (`chat_documents`). The document names each picture by its
//! content id, `sha256-` and the lowercase hex SHA-256 of its bytes; the bytes are stored under the
//! document's address and that id, nothing else.
//!
//! A picture is the document's content, so it follows the document's gates: a page's need
//! `EditMdx` to store and `ViewContent` to read, as appending and pulling its log do; a chat
//! document's need the channel's send and read permissions, as its log does. Every way of failing
//! the gate (no such node, its chat off, not a chat document's id, no permission) is one refusal,
//! `Denied`, so the answer is no oracle for which nodes or documents exist. `NotFound` is answered
//! only to a caller the read gate admitted.
//!
//! The upload travels in the chunks a chat file does (`chat_attachments`), each answered before
//! the next; the server hashes what arrived and keeps nothing that is not the id. Request and
//! answer only: nothing about a picture is pushed to anyone.

use crate::chat_attachments::{check_upload_chunk, is_attachment_id};
use crate::chat_documents::{CHANNEL_READ, CHANNEL_WRITE};
use crate::structs::Permission;
use citadel_internal_service_types::plaintext_debug_fmt;
use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What every picture's content id starts with; 64 lowercase hex digits follow.
pub const PICTURE_ID_PREFIX: &str = "sha256-";

/// Which document a picture belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PictureDocument {
    pub node_id: String,
    /// `None` is the node's page; `Some` is the id of a document shared in the node's chat.
    pub chat_doc: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DocumentPicturesRequest {
    /// One chunk of the picture `content_id`, `size_bytes` long, of `doc`. The chunk that
    /// completes it stores it.
    UploadChunk {
        doc: PictureDocument,
        content_id: String,
        #[ts(type = "bigint")]
        size_bytes: u64,
        index: u32,
        total_chunks: u32,
        #[debug(with = plaintext_debug_fmt)]
        #[ts(type = "Uint8Array")]
        #[serde(with = "citadel_internal_service_types::wire_bytes")]
        bytes: Vec<u8>,
    },
    /// Chunk `index` of the picture `content_id` of `doc`.
    ReadChunk {
        doc: PictureDocument,
        content_id: String,
        index: u32,
    },
    /// What this server keeps of `doc`'s pictures, so the client refuses a picture it would not
    /// keep, with the reason, before sending any of it. Asked of a member who may add pictures.
    Limits { doc: PictureDocument },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DocumentPicturesResponse {
    /// Chunk `index` arrived; `stored` once the whole picture is held under `content_id`.
    ChunkStored {
        doc: PictureDocument,
        content_id: String,
        index: u32,
        stored: bool,
    },
    Chunk {
        doc: PictureDocument,
        content_id: String,
        index: u32,
        total_chunks: u32,
        #[ts(type = "bigint")]
        size_bytes: u64,
        #[debug(with = plaintext_debug_fmt)]
        #[ts(type = "Uint8Array")]
        #[serde(with = "citadel_internal_service_types::wire_bytes")]
        bytes: Vec<u8>,
    },
    /// The largest picture, and the most pictures, this server keeps for `doc`.
    Limits {
        doc: PictureDocument,
        #[ts(type = "bigint")]
        max_bytes: u64,
        max_pictures: u32,
    },
    /// `content_id` is the picture's; `None` answers `Limits`, which names none.
    Refused {
        doc: PictureDocument,
        content_id: Option<String>,
        refusal: DocumentPictureRefusal,
    },
}

/// Why a document picture request was not carried out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DocumentPictureRefusal {
    /// The document's gate refused: no such node, its chat is off, not a chat document's id, or
    /// the caller lacks the permission. One answer, so it is no oracle.
    Denied,
    /// The caller may read the document, and it holds no picture by that id.
    NotFound,
    /// The picture is larger than this server keeps.
    TooLarge {
        #[ts(type = "bigint")]
        max_bytes: u64,
    },
    /// The content id or the chunk is not shaped as a picture's.
    BadChunk,
    /// The chunks did not hash to the content id they were uploaded under; nothing was kept.
    Mismatch,
    /// The document holds as many pictures as one document may.
    DocumentFull { max_pictures: u32 },
    /// Storing it would take the workspace past its plan's storage.
    StorageFull,
    /// The server could not say what it may store (its storage entitlement, or its picture
    /// limits, are not available), so it stored nothing.
    Unavailable,
}

/// The hex digest `content_id` names, when it is a picture's content id.
pub fn picture_digest(content_id: &str) -> Option<&str> {
    content_id
        .strip_prefix(PICTURE_ID_PREFIX)
        .filter(|digest| is_attachment_id(digest))
}

/// Whether one uploaded chunk fits the picture it names, by the rules a chat file's chunk follows
/// (`chat_attachments::check_upload_chunk`).
pub fn check_picture_chunk(
    content_id: &str,
    size_bytes: u64,
    index: u32,
    total_chunks: u32,
    len: usize,
) -> Result<(), DocumentPictureRefusal> {
    let digest = picture_digest(content_id).ok_or(DocumentPictureRefusal::BadChunk)?;
    check_upload_chunk(digest, size_bytes, index, total_chunks, len)
        .map_err(|_| DocumentPictureRefusal::BadChunk)
}

impl DocumentPicturesRequest {
    pub fn doc(&self) -> &PictureDocument {
        match self {
            Self::UploadChunk { doc, .. } | Self::ReadChunk { doc, .. } | Self::Limits { doc } => {
                doc
            }
        }
    }

    /// The picture the request is about; `None` for `Limits`.
    pub fn content_id(&self) -> Option<&str> {
        match self {
            Self::UploadChunk { content_id, .. } | Self::ReadChunk { content_id, .. } => {
                Some(content_id)
            }
            Self::Limits { .. } => None,
        }
    }
}

/// What each request needs on the document's node: storing a picture, and asking how large one
/// may be, is writing the document; reading one is reading it, by the page's gates or the channel's.
pub fn required_permission(request: &DocumentPicturesRequest) -> Permission {
    let writes = matches!(
        request,
        DocumentPicturesRequest::UploadChunk { .. } | DocumentPicturesRequest::Limits { .. }
    );
    match (request.doc().chat_doc.is_some(), writes) {
        (false, true) => Permission::EditMdx,
        (false, false) => Permission::ViewContent,
        (true, true) => CHANNEL_WRITE,
        (true, false) => CHANNEL_READ,
    }
}
