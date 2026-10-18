//! The rules of one document's update log. Pure: what an append numbers, what a pull returns
//! and what a snapshot drops are decided here; `transaction::documents_store` does the reads
//! and writes.

use serde::{Deserialize, Serialize};
use std::ops::RangeInclusive;

/// Where a document's log stands. The only record of it: the snapshot's coverage and the
/// updates held are both read from here.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LogHead {
    /// The newest update's sequence number; 0 before the first.
    pub latest_seq: u64,
    /// The stored snapshot covers every update up to this; 0 when there is none.
    pub snapshot_upto: u64,
    /// The lowest sequence number that may still be stored. Below `snapshot_upto + 1` only
    /// while a compaction is dropping the updates it covered.
    pub retained_from: u64,
}

impl LogHead {
    /// A document no one has written.
    pub const EMPTY: LogHead = LogHead {
        latest_seq: 0,
        snapshot_upto: 0,
        retained_from: 1,
    };

    /// How many updates arrived since the last snapshot.
    pub fn pending(&self) -> u64 {
        self.latest_seq - self.snapshot_upto
    }

    /// The head after one more update, which takes `latest_seq + 1`.
    pub fn appended(&self) -> LogHead {
        LogHead {
            latest_seq: self.latest_seq + 1,
            ..*self
        }
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
/// whichever is newer, at most `max_updates` of them.
pub(crate) fn plan_pull(head: &LogHead, since_seq: u64, max_updates: u32) -> PullPlan {
    let with_snapshot = since_seq < head.snapshot_upto;
    let first = since_seq.max(head.snapshot_upto) + 1;
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

/// A snapshot at `upto_seq`: the head while the covered updates are dropped, and those updates.
/// The head after the drop is `compacted`.
pub(crate) fn plan_snapshot(
    head: &LogHead,
    upto_seq: u64,
) -> Result<(LogHead, RangeInclusive<u64>), SnapshotConflict> {
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
    let covering = LogHead {
        snapshot_upto: upto_seq,
        ..*head
    };
    Ok((covering, head.retained_from..=upto_seq))
}

/// The head once a snapshot's covered updates are gone.
pub(crate) fn compacted(covering: &LogHead) -> LogHead {
    LogHead {
        retained_from: covering.snapshot_upto + 1,
        ..*covering
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head(latest_seq: u64, snapshot_upto: u64) -> LogHead {
        LogHead {
            latest_seq,
            snapshot_upto,
            retained_from: snapshot_upto + 1,
        }
    }

    #[test]
    fn appends_number_from_one_and_never_repeat() {
        let first = LogHead::EMPTY.appended();
        assert_eq!(first.latest_seq, 1);
        assert_eq!(first.appended().latest_seq, 2);
    }

    #[test]
    fn a_reader_with_nothing_gets_everything_from_one() {
        let plan = plan_pull(&head(3, 0), 0, 10);
        assert_eq!(
            plan,
            PullPlan {
                with_snapshot: false,
                seqs: 1..=3,
                has_more: false
            }
        );
    }

    #[test]
    fn a_reader_gets_only_what_follows_its_state() {
        let plan = plan_pull(&head(5, 0), 3, 10);
        assert_eq!(plan.seqs, 4..=5);
    }

    #[test]
    fn a_page_holds_at_most_the_limit_and_says_there_is_more() {
        let plan = plan_pull(&head(5, 0), 0, 2);
        assert_eq!(
            plan,
            PullPlan {
                with_snapshot: false,
                seqs: 1..=2,
                has_more: true
            }
        );
        let last = plan_pull(&head(5, 0), 4, 2);
        assert_eq!(
            last,
            PullPlan {
                with_snapshot: false,
                seqs: 5..=5,
                has_more: false
            }
        );
    }

    #[test]
    fn a_reader_older_than_the_snapshot_gets_it_and_the_tail() {
        let plan = plan_pull(&head(9, 6), 2, 10);
        assert_eq!(
            plan,
            PullPlan {
                with_snapshot: true,
                seqs: 7..=9,
                has_more: false
            }
        );
    }

    #[test]
    fn a_reader_exactly_at_the_snapshot_does_not_get_it_again() {
        let plan = plan_pull(&head(9, 6), 6, 10);
        assert!(!plan.with_snapshot);
        assert_eq!(plan.seqs, 7..=9);
    }

    #[test]
    fn a_reader_ahead_of_the_log_gets_nothing() {
        let plan = plan_pull(&head(3, 0), 7, 10);
        assert!(plan.seqs.is_empty());
        assert!(!plan.has_more);
    }

    #[test]
    fn compaction_is_asked_for_at_the_threshold_not_before() {
        assert_eq!(compaction_due(&head(4, 0), 5), None);
        assert_eq!(compaction_due(&head(5, 0), 5), Some(5));
        assert_eq!(compaction_due(&head(12, 5), 5), Some(7));
    }

    #[test]
    fn a_snapshot_drops_what_it_covers_and_keeps_the_rest() {
        let (covering, dropped) = plan_snapshot(&head(8, 2), 5).expect("plan");
        assert_eq!(dropped, 3..=5);
        assert_eq!(covering.snapshot_upto, 5);
        assert_eq!(covering.retained_from, 3, "kept until the drop is done");
        assert_eq!(compacted(&covering), head(8, 5));
    }

    #[test]
    fn a_snapshot_cannot_cover_updates_not_yet_stored_or_go_backwards() {
        assert_eq!(
            plan_snapshot(&head(4, 0), 5),
            Err(SnapshotConflict::Ahead { latest_seq: 4 })
        );
        assert_eq!(
            plan_snapshot(&head(9, 6), 6),
            Err(SnapshotConflict::Behind { stored_upto_seq: 6 })
        );
    }
}
