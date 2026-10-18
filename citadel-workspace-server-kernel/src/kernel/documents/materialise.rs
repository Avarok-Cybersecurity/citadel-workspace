//! Building a document from its log, for the server's own compaction. Pure and CPU-bound: the
//! caller runs it off the event loop (`platform::run_blocking`).
//!
//! The base is the stored snapshot, or the blank document every editor opens a new one from.
//! Every update after it is applied in sequence order; the result is the snapshot of exactly
//! what the log holds. An update that waits for an operation the log does not hold would be
//! lost from that snapshot, so it is an error, never a smaller snapshot.

use super::crdt::{clocks, Clocks};
use cdoc_crdt::{blank, ClientId, Doc};
use citadel_workspace_types::documents::DocumentUpdate;

/// The replica the server builds in. It never edits, so its client id is never written; it
/// only has to be one `blank` accepts.
const SERVER_REPLICA: ClientId = ClientId(u64::MAX);

/// The v2 snapshot of `base` with every update in `tail` applied, and the state vector it
/// holds. `Err` says why not.
pub(crate) fn materialise(
    base: Option<&[u8]>,
    tail: &[DocumentUpdate],
) -> Result<(Vec<u8>, Clocks), String> {
    let mut doc = match base {
        Some(snapshot) => Doc::decode_snapshot(snapshot, SERVER_REPLICA)
            .map_err(|e| format!("the stored snapshot does not decode: {e}"))?,
        None => blank(SERVER_REPLICA).map_err(|e| format!("the blank document: {e}"))?,
    };
    for update in tail {
        doc.apply_update(&update.update)
            .map_err(|e| format!("update {} does not apply: {e}", update.seq))?;
    }
    if doc.has_pending() {
        return Err(
            "the log holds updates that wait for operations it does not hold; a snapshot of it \
             would drop them"
                .to_string(),
        );
    }
    Ok((doc.encode_snapshot(), clocks(&doc.state_vector())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::documents::crdt::snapshot_clocks;

    fn update(seq: u64, update: Vec<u8>) -> DocumentUpdate {
        DocumentUpdate {
            seq,
            doc_version: 1,
            update,
            author_cid: 1,
        }
    }

    #[test]
    fn the_log_on_a_blank_base_becomes_its_snapshot() {
        let mut alice = blank(ClientId(7)).expect("blank");
        let before = alice.state_vector();
        alice.insert_text(0, "hello").expect("type");
        let (built, held) =
            materialise(None, &[update(1, alice.encode_diff(&before))]).expect("materialises");
        assert_eq!(built, alice.encode_snapshot());
        assert_eq!(held, snapshot_clocks(&built).expect("decodes"));
    }

    #[test]
    fn a_snapshot_base_is_continued_from() {
        let mut alice = blank(ClientId(7)).expect("blank");
        alice.insert_text(0, "one").expect("type");
        let base = alice.encode_snapshot();
        let before = alice.state_vector();
        alice.insert_text(3, " two").expect("type");
        let (built, _) = materialise(Some(&base), &[update(2, alice.encode_diff(&before))])
            .expect("materialises");
        assert_eq!(
            snapshot_clocks(&built).expect("decodes"),
            snapshot_clocks(&alice.encode_snapshot()).expect("decodes")
        );
    }

    #[test]
    fn an_update_missing_its_history_is_refused_not_dropped() {
        let mut alice = blank(ClientId(7)).expect("blank");
        alice.insert_text(0, "one").expect("type");
        let skipped = alice.state_vector();
        alice.insert_text(3, " two").expect("type");
        // Only the second edit, whose origins are the first.
        let orphan = update(1, alice.encode_diff(&skipped));
        assert!(materialise(None, &[orphan]).is_err());
    }
}
