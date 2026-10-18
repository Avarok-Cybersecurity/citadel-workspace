//! The `[documents]` section of `kernel.toml`: every bound the relay enforces. All required,
//! none zero, and the ones that depend on each other checked against each other at startup.

use serde::Deserialize;

/// How many bytes of a request frame one payload byte can take: serde_json writes a `Vec<u8>` as
/// a list of decimal numbers, at most three digits and a comma each. A fact of the encoding, not a
/// tunable: it is what a frame must leave room for, so a frame cap below it would refuse
/// snapshots the snapshot cap accepts.
pub const JSON_BYTES_PER_PAYLOAD_BYTE: u64 = 4;

/// The `[documents]` section of `kernel.toml`. Every field is required.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DocumentsConfig {
    /// The most updates one `Pull` returns; the reader pulls again for the rest.
    pub max_updates_per_pull: u32,
    /// How many updates since the last snapshot make `Appended` ask for a new one.
    pub snapshot_min_updates: u64,
    /// The largest update an `Append` may carry, in bytes.
    pub max_update_bytes: u64,
    /// The largest snapshot a `StoreSnapshot` may carry, in bytes.
    pub max_snapshot_bytes: u64,
    /// The largest awareness payload the relay forwards, in bytes.
    pub max_awareness_bytes: u64,
    /// How many awareness payloads one session may send per second.
    pub awareness_per_second: u32,
    /// How many appends one session may send per second.
    pub appends_per_second: u32,
    /// How many pulls one session may send per second.
    pub pulls_per_second: u32,
    /// The most bytes of updates one document holds since its last snapshot; an append past it
    /// is refused (`LogFull`) until a snapshot compacts them. Must exceed
    /// `snapshot_min_updates * max_update_bytes`, so writers are asked to compact before it is
    /// reached.
    pub max_pending_log_bytes: u64,
    /// The bytes of updates held since the last snapshot at which the server compacts the log
    /// itself: it materialises the document and stores the snapshot, so a log's liveness never
    /// depends on a writer answering the compaction hint. Below `max_pending_log_bytes`, which
    /// stays the hard backstop.
    pub compact_at_pending_bytes: u64,
    /// How many sequence numbers of the updates a snapshot covers are kept after it is stored,
    /// before they are dropped: a stored snapshot cannot destroy the history right behind it.
    pub retain_covered_updates_seqs: u64,
    /// The most CRDT client ids one document may bind to authors. Bounds the log's head, which
    /// every append rewrites.
    pub max_clients_per_document: u32,
    /// The largest request frame the kernel decodes at all, in bytes; a longer one is refused
    /// before it is parsed. Must exceed the largest payload above as JSON
    /// (`JSON_BYTES_PER_PAYLOAD_BYTE` per byte), so every payload a cap accepts fits in a frame.
    pub max_request_frame_bytes: u64,
}

impl DocumentsConfig {
    /// A zero in any field would refuse every request of its kind, ask for a snapshot after
    /// every update, or keep nothing a snapshot covers; bounds that contradict each other would
    /// refuse what another bound admits. Either is a configuration mistake, said at startup.
    pub fn validate(&self) -> Result<(), String> {
        let zero = [
            ("max_updates_per_pull", u64::from(self.max_updates_per_pull)),
            ("snapshot_min_updates", self.snapshot_min_updates),
            ("max_update_bytes", self.max_update_bytes),
            ("max_snapshot_bytes", self.max_snapshot_bytes),
            ("max_awareness_bytes", self.max_awareness_bytes),
            ("awareness_per_second", u64::from(self.awareness_per_second)),
            ("appends_per_second", u64::from(self.appends_per_second)),
            ("pulls_per_second", u64::from(self.pulls_per_second)),
            ("max_pending_log_bytes", self.max_pending_log_bytes),
            ("compact_at_pending_bytes", self.compact_at_pending_bytes),
            (
                "retain_covered_updates_seqs",
                self.retain_covered_updates_seqs,
            ),
            (
                "max_clients_per_document",
                u64::from(self.max_clients_per_document),
            ),
            ("max_request_frame_bytes", self.max_request_frame_bytes),
        ]
        .into_iter()
        .find(|(_, value)| *value == 0);
        if let Some((name, _)) = zero {
            return Err(format!("[documents] {name} must be greater than zero"));
        }
        let hinted = self
            .snapshot_min_updates
            .checked_mul(self.max_update_bytes)
            .filter(|bytes| *bytes < self.max_pending_log_bytes);
        if hinted.is_none() {
            return Err(
                "[documents] max_pending_log_bytes must exceed snapshot_min_updates * \
                 max_update_bytes, or a log can fill before a writer is asked to compact it"
                    .to_string(),
            );
        }
        if self.compact_at_pending_bytes >= self.max_pending_log_bytes {
            return Err(
                "[documents] compact_at_pending_bytes must be below max_pending_log_bytes, or the \
                 server would refuse appends before it compacts"
                    .to_string(),
            );
        }
        let largest = self
            .max_update_bytes
            .max(self.max_snapshot_bytes)
            .max(self.max_awareness_bytes);
        let framed = largest
            .checked_mul(JSON_BYTES_PER_PAYLOAD_BYTE)
            .filter(|bytes| *bytes < self.max_request_frame_bytes);
        if framed.is_none() {
            return Err(format!(
                "[documents] max_request_frame_bytes must exceed {JSON_BYTES_PER_PAYLOAD_BYTE} \
                 times the largest of max_update_bytes, max_snapshot_bytes and \
                 max_awareness_bytes ({largest}), or a payload its cap accepts cannot arrive"
            ));
        }
        Ok(())
    }
}
