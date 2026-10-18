//! Committing a snapshot, whoever built it: under the log's lock, refused unless it is newer
//! than the stored one, no further than the log, and its state vector (`held`) holds every clock
//! the updates up to `upto_seq` write; then stored, and the covered updates behind the retention
//! window dropped.

use super::node_exists;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::coverage::{coverage, covering};
use crate::kernel::documents::crdt::{first_uncovered, Clocks};
use crate::kernel::documents::log::{check_snapshot, compaction, SnapshotConflict};
use crate::kernel::documents::DocumentsRelay;
use crate::kernel::transaction::documents_store::StoredSnapshot;
use crate::platform::{SystemTime, UNIX_EPOCH};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::documents::DocumentRefusal;

pub(super) fn now_ms() -> Result<u64, NetworkError> {
    let since = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| NetworkError::msg(format!("the clock is before the Unix epoch: {e}")))?;
    u64::try_from(since.as_millis()).map_err(|e| NetworkError::msg(e.to_string()))
}

/// `Ok(Err)` is a refusal: nothing was stored or dropped.
pub(super) async fn commit<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    node_id: &str,
    stored: StoredSnapshot,
    held: &Clocks,
    upto_seq: u64,
) -> Result<Result<(), DocumentRefusal>, NetworkError> {
    let config = &relay.config;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _log = backend.lock_document(node_id).await;
    if !node_exists(kernel, node_id).await? {
        return Ok(Err(DocumentRefusal::NoSuchNode {
            node_id: node_id.to_string(),
        }));
    }
    let head = backend.document_head(node_id).await?;
    match check_snapshot(&head, upto_seq) {
        Ok(()) => {}
        Err(SnapshotConflict::Ahead { latest_seq }) => {
            return Ok(Err(DocumentRefusal::SnapshotAhead {
                node_id: node_id.to_string(),
                upto_seq,
                latest_seq,
            }))
        }
        Err(SnapshotConflict::Behind { stored_upto_seq }) => {
            return Ok(Err(DocumentRefusal::SnapshotBehind {
                node_id: node_id.to_string(),
                upto_seq,
                stored_upto_seq,
            }))
        }
    }
    let tail = backend
        .document_updates(node_id, head.snapshot_upto + 1..=head.latest_seq)
        .await?;
    let needs = coverage(&head, upto_seq, &tail).map_err(NetworkError::msg)?;
    if let Some((crdt_client, needed_clock, held_clock)) = first_uncovered(&needs.needed, held) {
        return Ok(Err(DocumentRefusal::SnapshotIncomplete {
            node_id: node_id.to_string(),
            upto_seq,
            crdt_client,
            needed_clock,
            held_clock,
        }));
    }
    let covering = covering(&head, upto_seq, needs);
    let (dropped, compacted) = compaction(&covering, config.retain_covered_updates_seqs);
    // Snapshot, then the head that says it covers `upto_seq`, then the drop. Stopped after the
    // first, a reader gets the new snapshot and updates it already holds, which merge as no-ops;
    // after the second, the head still names the undropped updates, so nothing is leaked.
    backend.save_document_snapshot(node_id, &stored).await?;
    backend.save_document_head(node_id, &covering).await?;
    backend.drop_document_updates(node_id, dropped).await?;
    backend.save_document_head(node_id, &compacted).await?;
    Ok(Ok(()))
}
