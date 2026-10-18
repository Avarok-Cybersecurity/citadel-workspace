use super::admission::{admit, AppendRefused};
use super::crdt::Clocks;
use super::log::LogHead;
use super::DocumentsConfig;
use crate::kernel::documents::JSON_BYTES_PER_PAYLOAD_BYTE;

fn config() -> DocumentsConfig {
    DocumentsConfig {
        max_updates_per_pull: 8,
        snapshot_min_updates: 2,
        max_update_bytes: 10,
        max_snapshot_bytes: 10,
        max_awareness_bytes: 10,
        awareness_per_second: 8,
        appends_per_second: 8,
        pulls_per_second: 8,
        max_pending_log_bytes: 25,
        compact_at_pending_bytes: 20,
        retain_covered_updates_seqs: 4,
        max_clients_per_document: 2,
        max_request_frame_bytes: 10 * JSON_BYTES_PER_PAYLOAD_BYTE + 1,
    }
}

fn writes(clients: &[u64]) -> Clocks {
    clients.iter().map(|&c| (c, 1)).collect()
}

const ALICE: u64 = 100;
const BOB: u64 = 200;

#[test]
fn appends_number_from_one_and_never_repeat() {
    let first = admit(&LogHead::EMPTY, &writes(&[7]), ALICE, 1, &config()).expect("first");
    assert_eq!(first.latest_seq, 1);
    let second = admit(&first, &writes(&[7]), ALICE, 1, &config()).expect("second");
    assert_eq!(second.latest_seq, 2);
    assert_eq!(second.pending_bytes, 2);
}

#[test]
fn a_client_id_belongs_to_the_author_that_first_wrote_as_it() {
    let head = admit(&LogHead::EMPTY, &writes(&[7]), ALICE, 1, &config()).expect("alice");
    assert_eq!(head.authors.get(&7), Some(&ALICE));
    assert_eq!(
        admit(&head, &writes(&[7]), BOB, 1, &config()),
        Err(AppendRefused::Foreign { crdt_client: 7 })
    );
    // Hiding the foreign client among one's own does not help.
    assert_eq!(
        admit(&head, &writes(&[9, 7]), BOB, 1, &config()),
        Err(AppendRefused::Foreign { crdt_client: 7 })
    );
    let bob = admit(&head, &writes(&[9]), BOB, 1, &config()).expect("bob's own client");
    assert_eq!(bob.authors.get(&9), Some(&BOB));
}

#[test]
fn no_one_writes_as_the_blank_client() {
    assert_eq!(
        admit(&LogHead::EMPTY, &writes(&[0]), ALICE, 1, &config()),
        Err(AppendRefused::Reserved)
    );
    assert_eq!(
        admit(&LogHead::EMPTY, &writes(&[0, 7]), ALICE, 1, &config()),
        Err(AppendRefused::Reserved)
    );
}

#[test]
fn a_document_holds_at_most_the_configured_clients() {
    let head = admit(&LogHead::EMPTY, &writes(&[1, 2]), ALICE, 1, &config()).expect("two");
    assert_eq!(
        admit(&head, &writes(&[3]), ALICE, 1, &config()),
        Err(AppendRefused::TooManyClients { max_clients: 2 })
    );
    admit(&head, &writes(&[2]), ALICE, 1, &config()).expect("a known client is no new one");
}

#[test]
fn appends_past_the_pending_cap_are_refused_until_compacted() {
    let mut head = LogHead::EMPTY;
    for _ in 0..2 {
        head = admit(&head, &writes(&[7]), ALICE, 10, &config()).expect("under the cap");
    }
    admit(&head, &writes(&[7]), ALICE, 5, &config()).expect("exactly at the cap");
    assert_eq!(
        admit(&head, &writes(&[7]), ALICE, 6, &config()),
        Err(AppendRefused::LogFull {
            pending_bytes: 20,
            max_bytes: 25
        })
    );
}
