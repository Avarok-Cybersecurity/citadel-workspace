//! The rules of one document's update log. Pure: what a pull returns and what a snapshot drops
//! are decided here, what an append may write in `admission`, what a snapshot must hold in
//! `coverage`; `transaction::documents_store` does the reads and writes.

use super::crdt::Clocks;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ops::RangeInclusive;

/// Where a document's log stands. The only record of it: the snapshot's coverage, the updates
/// held, their size and the client ids' authors are all read from here.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct LogHead {
    /// The newest update's sequence number; 0 before the first.
    pub latest_seq: u64,
    /// The stored snapshot covers every update up to this; 0 when there is none.
    pub snapshot_upto: u64,
    /// The lowest sequence number that may still be stored. The updates from here to
    /// `snapshot_upto` are covered ones kept for `retain_covered_updates_seqs`.
    pub retained_from: u64,
    /// The bytes of the updates after `snapshot_upto`, which `max_pending_log_bytes` bounds.
    pub pending_bytes: u64,
    /// The clocks the updates up to `snapshot_upto` write: what the next snapshot must hold,
    /// with what the updates after them write.
    pub covered: Clocks,
    /// Every CRDT client id the log has seen, and the author (session CID) that first wrote as
    /// it, which alone may write as it again. Never forgotten, so never re-bound.
    pub authors: BTreeMap<u64, u64>,
}

impl LogHead {
    /// A document no one has written.
    pub const EMPTY: LogHead = LogHead {
        latest_seq: 0,
        snapshot_upto: 0,
        retained_from: 1,
        pending_bytes: 0,
        covered: BTreeMap::new(),
        authors: BTreeMap::new(),
    };

    /// How many updates arrived since the last snapshot.
    pub fn pending(&self) -> u64 {
        self.latest_seq - self.snapshot_upto
    }

    /// Every sequence number that may be stored, for deleting the whole log.
    pub fn stored(&self) -> RangeInclusive<u64> {
        self.retained_from..=self.latest_seq
    }
}

/// Whether to ask for a snapshot, and how many updates it would fold in.
pub(crate) fn compaction_due(head: &LogHead, snapshot_min_updates: u64) -> Option<u64> {
    let pending = head.pending();
    (pending >= snapshot_min_updates).then_some(pending)
}

/// What a `Pull` reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PullPlan {
    pub with_snapshot: bool,
    /// Empty when there is nothing after the reader's state.
    pub seqs: RangeInclusive<u64>,
    pub has_more: bool,
}

/// A reader at `since_seq` gets the snapshot if its state predates it, then the updates after
/// whichever is newer, at most `max_updates` of them. A reader at the last sequence number there
/// can be has nothing after it.
pub(crate) fn plan_pull(head: &LogHead, since_seq: u64, max_updates: u32) -> PullPlan {
    let with_snapshot = since_seq < head.snapshot_upto;
    let Some(first) = since_seq.max(head.snapshot_upto).checked_add(1) else {
        return PullPlan {
            with_snapshot,
            seqs: RangeInclusive::new(1, 0),
            has_more: false,
        };
    };
    let last = head
        .latest_seq
        .min(first.saturating_add(u64::from(max_updates)) - 1);
    PullPlan {
        with_snapshot,
        seqs: first..=last,
        has_more: last < head.latest_seq,
    }
}

/// Why a snapshot cannot be stored at `upto_seq`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapshotConflict {
    /// The log holds no update `upto_seq` yet.
    Ahead { latest_seq: u64 },
    /// One at least this recent is stored.
    Behind { stored_upto_seq: u64 },
}

/// Whether a snapshot may be stored at `upto_seq` at all, before anything is read for it.
pub(crate) fn check_snapshot(head: &LogHead, upto_seq: u64) -> Result<(), SnapshotConflict> {
    if upto_seq > head.latest_seq {
        return Err(SnapshotConflict::Ahead {
            latest_seq: head.latest_seq,
        });
    }
    if upto_seq <= head.snapshot_upto {
        return Err(SnapshotConflict::Behind {
            stored_upto_seq: head.snapshot_upto,
        });
    }
    Ok(())
}

/// What a stored snapshot lets go: the covered updates more than `retain_seqs` sequence numbers
/// behind it, and the head once they are gone. `covering` is the head that names the snapshot.
pub(crate) fn compaction(covering: &LogHead, retain_seqs: u64) -> (RangeInclusive<u64>, LogHead) {
    let keep_from = covering.snapshot_upto.saturating_sub(retain_seqs) + 1;
    let retained_from = covering.retained_from.max(keep_from);
    let compacted = LogHead {
        retained_from,
        ..covering.clone()
    };
    (covering.retained_from..=retained_from - 1, compacted)
}
