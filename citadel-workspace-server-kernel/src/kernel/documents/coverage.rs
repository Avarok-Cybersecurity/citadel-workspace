//! What a snapshot must hold. Pure: given the log's head and the updates after its last
//! snapshot, the clocks a snapshot at `upto_seq` must cover, and what the log holds after it.
//!
//! A snapshot replaces the updates it covers for every reader older than it, so one that lacks
//! an operation those updates wrote would erase it. Its state vector must therefore hold every
//! clock they write. That is necessary, not sufficient: a snapshot can claim clocks it carries as
//! skips. What it cannot do is claim fewer, which is what a blank or truncated one does; the
//! covered updates are kept for `retain_covered_updates_seqs` regardless, with who stored it.

use super::crdt::{merge, update_clocks, Clocks};
use super::log::LogHead;
use citadel_workspace_types::documents::DocumentUpdate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Coverage {
    /// What the updates up to `upto_seq` write, the last snapshot's coverage included.
    pub needed: Clocks,
    /// The bytes of the updates after `upto_seq`.
    pub pending_bytes: u64,
}

/// `tail` is every update after `head.snapshot_upto`, in order. A stored update that does not
/// decode is an error: it was decoded when it was appended, so the store is damaged.
pub(crate) fn coverage(
    head: &LogHead,
    upto_seq: u64,
    tail: &[DocumentUpdate],
) -> Result<Coverage, String> {
    let mut needed = head.covered.clone();
    let mut pending_bytes = 0u64;
    for update in tail {
        if update.seq <= upto_seq {
            let writes = update_clocks(&update.update).map_err(|reason| {
                format!("stored update {} does not decode: {reason}", update.seq)
            })?;
            merge(&mut needed, &writes);
        } else {
            pending_bytes += update.update.len() as u64;
        }
    }
    Ok(Coverage {
        needed,
        pending_bytes,
    })
}

/// The head naming a snapshot at `upto_seq` that holds `coverage.needed`.
pub(crate) fn covering(head: &LogHead, upto_seq: u64, coverage: Coverage) -> LogHead {
    LogHead {
        snapshot_upto: upto_seq,
        covered: coverage.needed,
        pending_bytes: coverage.pending_bytes,
        ..head.clone()
    }
}
