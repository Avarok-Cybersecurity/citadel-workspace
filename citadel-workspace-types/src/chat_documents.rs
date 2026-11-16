//! Documents shared in a node's chat: the same update log, snapshot and awareness relay a node's
//! page uses (`documents`), one log per document a chat message names.
//!
//! A node channel has many readers, most of them offline at any moment, so a document made in it
//! cannot live between two agents the way a direct chat's does. It lives on the server, beside
//! the page, and the requests are the page's requests unchanged, addressed once by `chat_doc`.
//! The address is an envelope rather than a field on every request and answer: the page's wire
//! stays as it is, and every answer, push and refusal about a chat document carries the address,
//! because the envelope does, so a client can never take one document's answer for another's.
//!
//! A chat document is chat content, so it follows the channel's gates, not the page's: writing
//! needs what sending a message needs and reading what reading the channel needs
//! (`CHANNEL_WRITE`, `CHANNEL_READ`, which `group_access` asks for the channel itself). A node
//! with its chat turned off has no chat documents to reach.

use crate::documents::{DocumentsRequest, DocumentsResponse};
use crate::structs::Permission;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What sending, editing or deleting a message in a node channel needs.
pub const CHANNEL_WRITE: Permission = Permission::SendMessages;

/// What reading a node channel's messages needs.
pub const CHANNEL_READ: Permission = Permission::ViewContent;

/// What a chat document's id starts with: the chat's own mark for a Citadel Docs document
/// (`chat-document-id.ts`, `newChatDocumentId`), followed by a lowercase UUID.
pub const CHAT_DOCUMENT_ID_PREFIX: &str = "cdoc-";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatDocumentsRequest {
    /// The document's id as the chat message that shared it names it.
    pub chat_doc: String,
    /// Its `node_id` is the node whose channel the document was shared in.
    pub request: DocumentsRequest,
}

/// An answer, push or refusal about the chat document `chat_doc`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatDocumentsResponse {
    pub chat_doc: String,
    pub answer: DocumentsResponse,
}

/// What each request needs on the channel's node.
pub fn required_channel_permission(request: &DocumentsRequest) -> Permission {
    match request {
        DocumentsRequest::Append { .. } | DocumentsRequest::StoreSnapshot { .. } => CHANNEL_WRITE,
        DocumentsRequest::Pull { .. } | DocumentsRequest::Awareness { .. } => CHANNEL_READ,
    }
}

/// Whether `id` is a chat document's id: the prefix and a canonical lowercase UUID, nothing
/// else. The id becomes part of the log's storage keys, so nothing but this shape is stored.
pub fn is_chat_document_id(id: &str) -> bool {
    let Some(uuid) = id.strip_prefix(CHAT_DOCUMENT_ID_PREFIX) else {
        return false;
    };
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let mut groups = uuid.split('-');
    let shaped = GROUPS.iter().all(|&len| {
        groups.next().is_some_and(|group| {
            group.len() == len
                && group
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    });
    shaped && groups.next().is_none()
}
