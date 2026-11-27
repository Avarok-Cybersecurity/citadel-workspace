//! Files shared in a node's chat: kept on the workspace server, encrypted to the server as the
//! channel's messages are, and read by the channel's members (owner decision 4, 2026-10-24).
//!
//! A node channel has members who are offline and may number in the hundreds, so a file cannot be
//! offered to each of them over P2P the way a peer group does. The sender uploads it in chunks
//! (`UploadChunk`), the server keeps it under the node, and a `FileShare` message names it by its
//! id; a reader reads it back in chunks (`ReadChunk`).
//!
//! The id is the SHA-256 of the file's bytes, scoped to the node. Within a node the same file
//! shared twice is stored once and both shares name it; across nodes nothing is shared, so an id
//! says nothing about another channel. The server computes the digest of what arrived and refuses
//! a file that does not match the id it was uploaded under, so a reader can trust the bytes are the
//! ones the share names.
//!
//! Gates are the channel's: uploading needs what sending a message needs (`CHANNEL_WRITE`), reading
//! what reading the channel needs (`CHANNEL_READ`), and a node with its chat off has no files.
//! Every way of failing those is one refusal, `Denied`, so the answer is no oracle for which nodes
//! or files exist.

use crate::apps_protocol::ARTIFACT_CHUNK_BYTES;
use citadel_internal_service_types::plaintext_debug_fmt;
use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A file travels in chunks of this many bytes (the last may be shorter), for the same reason an
/// app artifact does: one request stays far under a tenant's frame limit.
pub const CHAT_ATTACHMENT_CHUNK_BYTES: u32 = ARTIFACT_CHUNK_BYTES;

/// The longest file name a share may carry, in bytes.
pub const MAX_ATTACHMENT_NAME_BYTES: usize = 255;

/// The longest MIME type a share may carry, in bytes.
pub const MAX_ATTACHMENT_MIME_BYTES: usize = 127;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ChatAttachmentsRequest {
    /// One chunk of the file whose SHA-256 is `sha256` and whose length is `size_bytes`, at the
    /// node `node_id`. The chunk that completes it stores it.
    UploadChunk {
        node_id: String,
        sha256: String,
        #[ts(type = "bigint")]
        size_bytes: u64,
        index: u32,
        total_chunks: u32,
        #[debug(with = plaintext_debug_fmt)]
        #[ts(type = "Uint8Array")]
        #[serde(with = "citadel_internal_service_types::wire_bytes")]
        bytes: Vec<u8>,
    },
    /// Chunk `index` of the file `attachment_id` shared at the node `node_id`.
    ReadChunk {
        node_id: String,
        attachment_id: String,
        index: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ChatAttachmentsResponse {
    /// Chunk `index` arrived; `stored` once the whole file is held under `attachment_id`.
    ChunkStored {
        node_id: String,
        attachment_id: String,
        index: u32,
        stored: bool,
    },
    Chunk {
        node_id: String,
        attachment_id: String,
        index: u32,
        total_chunks: u32,
        #[ts(type = "bigint")]
        size_bytes: u64,
        #[debug(with = plaintext_debug_fmt)]
        #[ts(type = "Uint8Array")]
        #[serde(with = "citadel_internal_service_types::wire_bytes")]
        bytes: Vec<u8>,
    },
    Refused {
        node_id: String,
        attachment_id: String,
        refusal: ChatAttachmentRefusal,
    },
}

/// Why a chat attachment request was not carried out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ChatAttachmentRefusal {
    /// No such node, its chat is off, the caller lacks the channel's permission, or (reading) no
    /// such file has been shared there: one answer, so it is no oracle.
    Denied,
    /// The file is larger than this server takes.
    TooLarge {
        #[ts(type = "bigint")]
        max_bytes: u64,
    },
    /// The chunk does not fit the file it claims to be part of.
    BadChunk,
    /// The chunks did not hash to the id they were uploaded under; nothing was kept.
    Mismatch,
    /// The node holds as many files as one node may.
    NodeFull { max_files: u32 },
    /// Storing it would take the workspace past its plan's storage.
    StorageFull,
    /// The server could not say what it may store (its storage entitlement, or its file size
    /// limit, is not available), so it stored nothing.
    Unavailable,
}

/// How many chunks a file of `size_bytes` travels in.
pub fn chunk_count(size_bytes: u64) -> u64 {
    size_bytes.div_ceil(u64::from(CHAT_ATTACHMENT_CHUNK_BYTES))
}

/// Whether `id` can be an attachment's id: 64 lowercase hex digits, as SHA-256 prints. The id
/// becomes part of storage keys, so nothing else is looked up.
pub fn is_attachment_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Whether one uploaded chunk fits the file it names: a valid id, a non-empty file, the right
/// number of chunks for its size, an index within them, and every chunk but the last full.
pub fn check_upload_chunk(
    sha256: &str,
    size_bytes: u64,
    index: u32,
    total_chunks: u32,
    len: usize,
) -> Result<(), ChatAttachmentRefusal> {
    let full = u64::from(CHAT_ATTACHMENT_CHUNK_BYTES);
    let shaped = is_attachment_id(sha256)
        && size_bytes > 0
        && chunk_count(size_bytes) == u64::from(total_chunks)
        && index < total_chunks;
    if !shaped {
        return Err(ChatAttachmentRefusal::BadChunk);
    }
    let last = index + 1 == total_chunks;
    let expected = if last {
        size_bytes - full * u64::from(index)
    } else {
        full
    };
    if len as u64 != expected {
        return Err(ChatAttachmentRefusal::BadChunk);
    }
    Ok(())
}

/// Why a share's name or type cannot be stored, or `None`. The name is shown and offered as a
/// download name, so it holds no path and no control character; the type is `type/subtype`.
pub fn share_fields_refusal(name: &str, mime: &str) -> Option<&'static str> {
    let name_ok = !name.trim().is_empty()
        && name.len() <= MAX_ATTACHMENT_NAME_BYTES
        && !name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\');
    if !name_ok {
        return Some(
            "A shared file's name must be a file name, without a path or control characters",
        );
    }
    let token = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$&^_.+-".contains(&b))
    };
    let mime_ok = mime.len() <= MAX_ATTACHMENT_MIME_BYTES
        && mime
            .split_once('/')
            .is_some_and(|(kind, sub)| token(kind) && token(sub));
    if !mime_ok {
        return Some("A shared file's type must be a MIME type such as application/pdf");
    }
    None
}
