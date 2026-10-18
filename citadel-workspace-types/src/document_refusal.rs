//! Why a documents request was not carried out: `documents`' refusals, in their own file.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
    /// Too many appends from this session (`appends_per_second`); send fewer, or batch them.
    AppendRateLimited { node_id: String },
    /// Too many pulls from this session (`pulls_per_second`); pull less often.
    PullRateLimited { node_id: String },
    /// The update is not a CRDT update this server can read; nothing was stored. `reason` is
    /// the decoder's.
    UpdateMalformed { node_id: String, reason: String },
    /// The update writes as the reserved blank-document client, which no replica may write as.
    ClientIdReserved { node_id: String },
    /// The update writes as a CRDT client another session's author first wrote as. A client id
    /// belongs to the author that first used it on this document, for good.
    ClientIdForeign {
        node_id: String,
        #[ts(type = "bigint")]
        crdt_client: u64,
    },
    /// The document has as many CRDT clients as it may hold (`max_clients_per_document`); a
    /// new one cannot be added.
    TooManyClients { node_id: String, max_clients: u32 },
    /// The updates held since the last snapshot reach `max_pending_log_bytes`: store a snapshot,
    /// which compacts them, then append again.
    LogFull {
        node_id: String,
        #[ts(type = "bigint")]
        pending_bytes: u64,
        #[ts(type = "bigint")]
        max_bytes: u64,
    },
    /// The snapshot is not a CRDT snapshot this server can read; nothing was stored or dropped.
    SnapshotMalformed { node_id: String, reason: String },
    /// The snapshot lacks updates the log holds up to `upto_seq`: it holds `crdt_client`'s
    /// clocks below `held_clock`, and the log holds them below `needed_clock`. Nothing was
    /// stored or dropped.
    SnapshotIncomplete {
        node_id: String,
        #[ts(type = "bigint")]
        upto_seq: u64,
        #[ts(type = "bigint")]
        crdt_client: u64,
        #[ts(type = "bigint")]
        needed_clock: u64,
        #[ts(type = "bigint")]
        held_clock: u64,
    },
    /// Appends, snapshots, pulls and awareness are attributed to the session that sent them
    /// (for the client-id binding, the snapshot's record and the per-session rates); this
    /// request came with none.
    NoSession,
    /// This server was started without a `[documents]` configuration.
    NotConfigured,
}
