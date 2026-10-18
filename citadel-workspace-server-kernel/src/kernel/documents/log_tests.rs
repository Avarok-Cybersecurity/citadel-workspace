use super::log::*;

fn head(latest_seq: u64, snapshot_upto: u64) -> LogHead {
    LogHead {
        latest_seq,
        snapshot_upto,
        retained_from: snapshot_upto + 1,
        ..LogHead::EMPTY
    }
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
fn a_reader_at_the_last_possible_seq_gets_nothing_rather_than_overflowing() {
    for at in [head(3, 0), head(9, 6), LogHead::EMPTY] {
        let plan = plan_pull(&at, u64::MAX, 10);
        assert!(plan.seqs.is_empty(), "{plan:?}");
        assert!(!plan.has_more);
        assert!(!plan.with_snapshot);
    }
}

#[test]
fn a_snapshot_keeps_the_covered_updates_its_window_holds() {
    let covering = LogHead {
        snapshot_upto: 8,
        ..head(10, 2)
    };
    let (dropped, compacted) = compaction(&covering, 3);
    assert_eq!(
        dropped,
        3..=5,
        "everything older than the three before the snapshot"
    );
    assert_eq!(compacted.retained_from, 6);
    assert_eq!(compacted.snapshot_upto, 8);
}

#[test]
fn a_window_wider_than_the_log_drops_nothing() {
    let covering = LogHead {
        snapshot_upto: 4,
        ..head(4, 0)
    };
    let (dropped, compacted) = compaction(&covering, 10);
    assert!(dropped.is_empty(), "{dropped:?}");
    assert_eq!(compacted, covering);
}

#[test]
fn a_later_snapshot_drops_only_what_the_last_left() {
    let covering = LogHead {
        snapshot_upto: 20,
        retained_from: 6,
        ..head(25, 8)
    };
    let (dropped, compacted) = compaction(&covering, 3);
    assert_eq!(dropped, 6..=17);
    assert_eq!(compacted.retained_from, 18);
}

#[test]
fn a_snapshot_cannot_cover_updates_not_yet_stored_or_go_backwards() {
    assert_eq!(
        check_snapshot(&head(4, 0), 5),
        Err(SnapshotConflict::Ahead { latest_seq: 4 })
    );
    assert_eq!(
        check_snapshot(&head(9, 6), 6),
        Err(SnapshotConflict::Behind { stored_upto_seq: 6 })
    );
    assert_eq!(check_snapshot(&head(9, 6), 9), Ok(()));
}
