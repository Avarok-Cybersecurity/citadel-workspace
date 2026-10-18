//! Documents: the collaborative-editing relay for a document node.
//!
//! The server holds each document node's CRDT update log and its latest snapshot, and relays
//! awareness (cursors, selections, presence) without storing it. The server decodes every update
//! and snapshot with `cdoc-crdt` (format v2) before it stores one, but never applies them:
//! decoding refuses damaged bytes, binds each CRDT client id to the author that first wrote as it,
//! and lets the server check that a snapshot holds everything it compacts. Awareness payloads stay
//! opaque. `doc_version` names the format the client encoded them in, so a reader can tell bytes
//! it cannot decode from bytes that are damaged.
//!
//! Sequence numbers are per node, assigned by the server, start at 1 and never repeat. A
//! snapshot covers every update up to and including its `upto_seq`, and is stored only if its
//! state vector holds every clock those updates write. Once it is stored, a reader whose state
//! is older than the snapshot is sent the snapshot and the updates after it; the covered updates
//! are kept for a configured number of sequence numbers (`retain_covered_updates`), then dropped.
//!
//! Every request is debug-logged by the command processor, so every byte field prints its length
//! only: the bytes are the document.

use crate::structs::Permission;
use citadel_internal_service_types::plaintext_debug_fmt;
use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use crate::document_refusal::DocumentRefusal;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DocumentsRequest {
    /// Needs `EditMdx` on the node. Answered `Appended` and announced to the node's readers as
    /// `DocumentUpdated`.
    Append {
        node_id: String,
        doc_version: u32,
        #[debug(with = plaintext_debug_fmt)]
        update: Vec<u8>,
        /// The client's own number for this update, echoed on `Appended` so the client can tell
        /// which of its pending updates the server has stored: the protocol has no request id.
        #[ts(type = "bigint")]
        client_seq: u64,
    },
    /// Needs `ViewContent` on the node. Everything after `since_seq` (0 for the whole document),
    /// a page at a time.
    Pull {
        node_id: String,
        #[ts(type = "bigint")]
        since_seq: u64,
    },
    /// Needs `EditMdx` on the node. `snapshot` must hold the effect of every update up to and
    /// including `upto_seq` (`SnapshotIncomplete` otherwise); those updates are dropped once the
    /// configured retention window has passed them.
    StoreSnapshot {
        node_id: String,
        doc_version: u32,
        #[debug(with = plaintext_debug_fmt)]
        snapshot: Vec<u8>,
        #[ts(type = "bigint")]
        upto_seq: u64,
    },
    /// Needs `ViewContent` on the node. Relayed to the node's other readers as
    /// `DocumentAwareness`, never stored.
    Awareness {
        node_id: String,
        #[debug(with = plaintext_debug_fmt)]
        payload: Vec<u8>,
    },
}

/// One stored update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DocumentUpdate {
    #[ts(type = "bigint")]
    pub seq: u64,
    pub doc_version: u32,
    #[debug(with = plaintext_debug_fmt)]
    pub update: Vec<u8>,
    #[ts(type = "bigint")]
    pub author_cid: u64,
}

/// The stored snapshot: the document as of `upto_seq`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DocumentSnapshot {
    pub doc_version: u32,
    #[debug(with = plaintext_debug_fmt)]
    pub bytes: Vec<u8>,
    #[ts(type = "bigint")]
    pub upto_seq: u64,
}

/// The server's hint that a writer should store a snapshot: `pending` updates are held since
/// the last one, at least the configured `snapshot_min_updates`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CompactionRequested {
    pub node_id: String,
    #[ts(type = "bigint")]
    pub pending: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DocumentsResponse {
    /// The update is stored as `seq`.
    Appended {
        node_id: String,
        #[ts(type = "bigint")]
        seq: u64,
        #[ts(type = "bigint")]
        client_seq: u64,
        compaction: Option<CompactionRequested>,
    },
    /// The answer to `Pull`. `snapshot` is present when `since_seq` predates it. `has_more`
    /// says another `Pull` from the last update's `seq` has more; `latest_seq` is the newest
    /// update the log holds (0 for none), so a reader can tell it is ahead of the server.
    Updates {
        node_id: String,
        snapshot: Option<DocumentSnapshot>,
        updates: Vec<DocumentUpdate>,
        has_more: bool,
        #[ts(type = "bigint")]
        latest_seq: u64,
    },
    SnapshotStored {
        node_id: String,
        #[ts(type = "bigint")]
        upto_seq: u64,
    },
    /// The relay took the awareness payload.
    AwarenessRelayed {
        node_id: String,
    },
    /// Announced to every other session that may view the node.
    DocumentUpdated {
        node_id: String,
        #[ts(type = "bigint")]
        seq: u64,
        doc_version: u32,
        #[debug(with = plaintext_debug_fmt)]
        update: Vec<u8>,
        #[ts(type = "bigint")]
        author_cid: u64,
    },
    /// Relayed to every other session that may view the node.
    DocumentAwareness {
        node_id: String,
        #[ts(type = "bigint")]
        from_cid: u64,
        #[debug(with = plaintext_debug_fmt)]
        payload: Vec<u8>,
    },
    /// The server compacted the log itself: it stored a snapshot it built from the log, covering
    /// every update up to `upto_seq`. Announced to every session that may view the node; a
    /// writer refused `LogFull` may append again.
    DocumentCompacted {
        node_id: String,
        #[ts(type = "bigint")]
        upto_seq: u64,
    },
    Refused(DocumentRefusal),
}

/// What each request needs on its node, named once for the handler and its callers.
pub fn required_permission(request: &DocumentsRequest) -> Permission {
    match request {
        DocumentsRequest::Append { .. } | DocumentsRequest::StoreSnapshot { .. } => {
            Permission::EditMdx
        }
        DocumentsRequest::Pull { .. } | DocumentsRequest::Awareness { .. } => {
            Permission::ViewContent
        }
    }
}

impl DocumentsRequest {
    pub fn node_id(&self) -> &str {
        match self {
            Self::Append { node_id, .. }
            | Self::Pull { node_id, .. }
            | Self::StoreSnapshot { node_id, .. }
            | Self::Awareness { node_id, .. } => node_id,
        }
    }
}
