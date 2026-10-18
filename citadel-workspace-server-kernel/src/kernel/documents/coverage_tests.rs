use super::coverage::{coverage, covering};
use super::log::LogHead;
use crate::kernel::documents::crdt::{first_uncovered, snapshot_clocks};
use cdoc_crdt::{ClientId, Doc};
use citadel_workspace_types::documents::DocumentUpdate;

fn logged(seq: u64, update: Vec<u8>) -> DocumentUpdate {
    DocumentUpdate {
        seq,
        doc_version: 1,
        update,
        author_cid: 1,
    }
}

/// Alice types three times; each update is what she adds.
fn alice_log() -> (Doc, Vec<DocumentUpdate>) {
    let mut alice = Doc::new(ClientId(7));
    let mut log = Vec::new();
    for (seq, text) in [(1, "one "), (2, "two "), (3, "three")] {
        let before = alice.state_vector();
        alice.insert_text(alice.len(), text).expect("type");
        log.push(logged(seq, alice.encode_diff(&before)));
    }
    (alice, log)
}

fn after(log: &[DocumentUpdate], upto: u64) -> Doc {
    let mut doc = Doc::new(ClientId(9));
    for u in log.iter().filter(|u| u.seq <= upto) {
        doc.apply_update(&u.update).expect("apply");
    }
    doc
}

#[test]
fn a_snapshot_of_the_whole_log_covers_it() {
    let (alice, log) = alice_log();
    let head = LogHead {
        latest_seq: 3,
        ..LogHead::EMPTY
    };
    let at = coverage(&head, 3, &log).expect("decodes");
    let held = snapshot_clocks(&alice.encode_snapshot()).expect("snapshot");
    assert_eq!(first_uncovered(&at.needed, &held), None);
    assert_eq!(at.pending_bytes, 0);
}

#[test]
fn a_blank_snapshot_covers_nothing_the_log_wrote() {
    let (_, log) = alice_log();
    let head = LogHead {
        latest_seq: 3,
        ..LogHead::EMPTY
    };
    let at = coverage(&head, 3, &log).expect("decodes");
    let blank = snapshot_clocks(&Doc::new(ClientId(9)).encode_snapshot()).expect("snapshot");
    assert_eq!(first_uncovered(&at.needed, &blank), Some((7, 13, 0)));
}

#[test]
fn a_snapshot_short_of_upto_is_short_and_one_at_it_is_not() {
    let (_, log) = alice_log();
    let head = LogHead {
        latest_seq: 3,
        ..LogHead::EMPTY
    };
    let at_two = coverage(&head, 2, &log).expect("decodes");
    assert_eq!(at_two.pending_bytes, log[2].update.len() as u64);
    let one = snapshot_clocks(&after(&log, 1).encode_snapshot()).expect("snapshot");
    assert!(first_uncovered(&at_two.needed, &one).is_some());
    let two = snapshot_clocks(&after(&log, 2).encode_snapshot()).expect("snapshot");
    assert_eq!(first_uncovered(&at_two.needed, &two), None);
}

#[test]
fn what_an_earlier_snapshot_covered_is_still_needed() {
    let (_, log) = alice_log();
    let earlier = coverage(&LogHead::EMPTY, 2, &log[..2]).expect("decodes");
    let head = covering(
        &LogHead {
            latest_seq: 3,
            ..LogHead::EMPTY
        },
        2,
        earlier,
    );
    // Only update 3 is after the head's snapshot; a snapshot holding only it is short.
    let at = coverage(&head, 3, &log[2..]).expect("decodes");
    let only_three = {
        let mut d = Doc::new(ClientId(9));
        let _ = d.apply_update(&log[2].update);
        d
    };
    let held = snapshot_clocks(&only_three.encode_snapshot()).expect("snapshot");
    assert!(first_uncovered(&at.needed, &held).is_some());
}

#[test]
fn damaged_snapshot_bytes_are_not_a_snapshot() {
    let (alice, _) = alice_log();
    let mut bytes = alice.encode_snapshot();
    bytes.truncate(bytes.len() - 1);
    assert!(snapshot_clocks(&bytes).is_err());
    assert!(snapshot_clocks(&[1, 2, 3]).is_err());
}
