//! Merging a Yjs update into a live document's stored state, on the server.
//!
//! Group-chat live documents (offices and rooms) are relayed and stored by the server, so the
//! server is where a document's one true state lives. It merges each update itself with `yrs`
//! (the Rust Yjs), rather than storing what a client claims the state now is:
//! - bytes that are not a v1 Yjs update are refused, never stored;
//! - an update or a merged state past its size cap is refused, so one member cannot grow a
//!   document without bound;
//! - the stored state is always re-encoded from the merged document, never a client snapshot.

use yrs::updates::decoder::Decode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

/// The largest single update accepted. A client coalesces its edits (update-coalescer.ts), so a
/// real update is far smaller; a paste of a whole book is refused rather than relayed.
pub const MAX_UPDATE_BYTES: usize = 64 * 1024;
/// The largest a document's merged state may grow: under the backend's 2 MB value limit.
pub const MAX_DOC_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeRefusal {
    UpdateTooLarge,
    NotAnUpdate,
    DocumentTooLarge,
}

impl std::fmt::Display for MergeRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UpdateTooLarge => write!(f, "that change is too large to send at once"),
            Self::NotAnUpdate => write!(f, "that is not a live document update"),
            Self::DocumentTooLarge => write!(f, "this live document has reached its size limit"),
        }
    }
}

/// `state` (empty for a new document) with `update` applied, re-encoded as one v1 update.
pub fn merge_update(state: &[u8], update: &[u8]) -> Result<Vec<u8>, MergeRefusal> {
    if update.len() > MAX_UPDATE_BYTES {
        return Err(MergeRefusal::UpdateTooLarge);
    }
    let incoming = Update::decode_v1(update).map_err(|_| MergeRefusal::NotAnUpdate)?;
    let doc = Doc::new();
    {
        let mut txn = doc.transact_mut();
        if !state.is_empty() {
            let stored = Update::decode_v1(state).map_err(|_| MergeRefusal::NotAnUpdate)?;
            txn.apply_update(stored)
                .map_err(|_| MergeRefusal::NotAnUpdate)?;
        }
        txn.apply_update(incoming)
            .map_err(|_| MergeRefusal::NotAnUpdate)?;
    }
    let merged = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    if merged.len() > MAX_DOC_BYTES {
        return Err(MergeRefusal::DocumentTooLarge);
    }
    Ok(merged)
}
