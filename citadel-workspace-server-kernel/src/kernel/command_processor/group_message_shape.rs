//! What a message's type must hold before the channel stores it.
//!
//! A `LiveDocument` message is what every reader opens the document from, so the id it names is
//! checked here, where it is stored, rather than failing later in each reader's tab.

use citadel_workspace_types::chat_documents::is_chat_document_id;
use citadel_workspace_types::GroupMessageType;

/// Said to a client whose message names a document by an id the chat would never make.
pub const NOT_A_CHAT_DOCUMENT: &str =
    "A live document must be named by the chat's own document id; the message was not sent";

/// Why `message_type` cannot be stored, or `None` when it can.
pub fn refusal(message_type: &GroupMessageType) -> Option<&'static str> {
    match message_type {
        GroupMessageType::LiveDocument { document_id } if !is_chat_document_id(document_id) => {
            Some(NOT_A_CHAT_DOCUMENT)
        }
        _ => None,
    }
}
