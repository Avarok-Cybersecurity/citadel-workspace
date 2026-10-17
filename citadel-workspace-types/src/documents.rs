//! Documents: the collaborative-editing relay for a document node.
//!
//! The server holds each document node's CRDT update log and its latest snapshot, and relays
//! awareness (cursors, selections, presence) without storing it. The bytes are opaque here: the
//! server orders, stores, bounds and forwards them, and never decodes them. `doc_version` names
//! the format the client encoded them in, so a reader can tell bytes it cannot decode from
//! bytes that are damaged.
//!
//! Sequence numbers are per node, assigned by the server, start at 1 and never repeat. A
//! snapshot covers every update up to and including its `upto_seq`; once it is stored those
//! updates are dropped, so a reader whose state is older than the snapshot is sent the snapshot
//! and the updates after it.
//!
//! Every request is debug-logged by the command processor, so every byte field prints its length
//! only: the bytes are the document.

use crate::structs::Permission;
use citadel_internal_service_types::plaintext_debug_fmt;
use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
    /// including `upto_seq`; those updates are dropped once it is stored.
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
    Refused(DocumentRefusal),
}

/// Why a documents request was not carried out. A size is `size_bytes`, never `bytes`: the client
/// decodes u64 fields by NAME (`WORKSPACE_BIGINT_FIELDS`), and `DocumentSnapshot::bytes` is an
/// array, which would then fail to decode. Missing permission is not here: that is the
/// standard `Error("Permission denied: ...")` every request answers with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DocumentRefusal {
    /// The node does not exist, or no longer does.
    NoSuchNode { node_id: String },
    UpdateTooLarge {
        node_id: String,
        #[ts(type = "bigint")]
        size_bytes: u64,
        #[ts(type = "bigint")]
        max_bytes: u64,
    },
    SnapshotTooLarge {
        node_id: String,
        #[ts(type = "bigint")]
        size_bytes: u64,
        #[ts(type = "bigint")]
        max_bytes: u64,
    },
    AwarenessTooLarge {
        node_id: String,
        #[ts(type = "bigint")]
        size_bytes: u64,
        #[ts(type = "bigint")]
        max_bytes: u64,
    },
    /// `upto_seq` names an update the log does not hold yet.
    SnapshotAhead {
        node_id: String,
        #[ts(type = "bigint")]
        upto_seq: u64,
        #[ts(type = "bigint")]
        latest_seq: u64,
    },
    /// A snapshot at least this recent is already stored.
    SnapshotBehind {
        node_id: String,
        #[ts(type = "bigint")]
        upto_seq: u64,
        #[ts(type = "bigint")]
        stored_upto_seq: u64,
    },
    /// Too many awareness payloads from this session; send fewer.
    AwarenessRateLimited { node_id: String },
    /// Appends and awareness are attributed to the session that sent them; this request came
    /// with none.
    NoSession,
    /// This server was started without a `[documents]` configuration.
    NotConfigured,
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
