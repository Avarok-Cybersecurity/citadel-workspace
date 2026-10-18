//! The server compacting a document's log itself, once the updates held since its last snapshot
//! reach `compact_at_pending_bytes`, or an append is refused `LogFull`. A log's liveness then
//! never depends on a writer answering the compaction hint.
//!
//! The log is read under its lock, the document is built off the event loop with the lock
//! released (appends go on meanwhile), and the snapshot is committed as a writer's is, with the
//! same checks, at the sequence number that was read. Announced to the node's readers as
//! `DocumentCompacted`.

use super::commit::{commit, now_ms};
use super::node_exists;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::materialise::materialise;
use crate::kernel::documents::DocumentsRelay;
use crate::kernel::transaction::documents_store::{SnapshotAuthor, StoredSnapshot};
use crate::WorkspaceProtocolResponse;
use citadel_logging::{error, info};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsResponse};

/// Frees the document's place in `compacting` however the compaction ends.
struct InFlight {
    relay: DocumentsRelay,
    node_id: String,
}

impl Drop for InFlight {
    fn drop(&mut self) {
        self.relay.compacting.lock().remove(&self.node_id);
    }
}

/// Starts compacting `node_id` unless that is already under way.
pub(super) fn schedule<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    node_id: &str,
) {
    if !relay.compacting.lock().insert(node_id.to_string()) {
        return;
    }
    let in_flight = InFlight {
        relay: relay.clone(),
        node_id: node_id.to_string(),
    };
    let kernel = kernel.clone();
    crate::platform::spawn(async move {
        let node_id = in_flight.node_id.clone();
        match compact(&kernel, &in_flight.relay, &node_id).await {
            Ok(Some(upto_seq)) => {
                info!(target: "citadel", "[DOCUMENTS] compacted {node_id} up to {upto_seq}")
            }
            Ok(None) => {}
            Err(e) => error!(target: "citadel", "[DOCUMENTS] could not compact {node_id}: {e}"),
        }
        drop(in_flight);
    });
}

/// `Some(upto_seq)` when a snapshot was stored; `None` when there was nothing to do or a
/// writer's snapshot got there first.
async fn compact<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    node_id: &str,
) -> Result<Option<u64>, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let (base, tail, upto_seq) = {
        let _log = backend.lock_document(node_id).await;
        if !node_exists(kernel, node_id).await? {
            return Ok(None);
        }
        let head = backend.document_head(node_id).await?;
        if head.latest_seq == head.snapshot_upto {
            return Ok(None);
        }
        let base = backend.document_snapshot(node_id).await?.map(|s| s.bytes);
        if base.is_none() && head.snapshot_upto > 0 {
            return Err(NetworkError::msg(format!(
                "document {node_id} names a snapshot it does not hold"
            )));
        }
        let tail = backend
            .document_updates(node_id, head.snapshot_upto + 1..=head.latest_seq)
            .await?;
        (base, tail, head.latest_seq)
    };
    let doc_version = tail
        .last()
        .map(|update| update.doc_version)
        .ok_or_else(|| NetworkError::msg("a non-empty log read no updates"))?;
    let (bytes, held) = crate::platform::run_blocking(move || materialise(base.as_deref(), &tail))
        .await
        .map_err(NetworkError::msg)?
        .map_err(NetworkError::msg)?;
    let max_bytes = relay.config.max_snapshot_bytes;
    if bytes.len() as u64 > max_bytes {
        return Err(NetworkError::msg(format!(
            "its snapshot is {} bytes, over max_snapshot_bytes ({max_bytes})",
            bytes.len()
        )));
    }
    let stored = StoredSnapshot {
        doc_version,
        bytes,
        stored_by: SnapshotAuthor::Server,
        stored_at_ms: now_ms()?,
    };
    match commit(kernel, relay, node_id, stored, &held, upto_seq).await? {
        Ok(()) => {}
        Err(DocumentRefusal::SnapshotBehind { .. }) | Err(DocumentRefusal::NoSuchNode { .. }) => {
            return Ok(None)
        }
        Err(refusal) => {
            return Err(NetworkError::msg(format!(
                "its own snapshot was refused: {refusal:?}"
            )))
        }
    }
    kernel.broadcast_to_node(
        WorkspaceProtocolResponse::Documents(DocumentsResponse::DocumentCompacted {
            node_id: node_id.to_string(),
            upto_seq,
        }),
        None,
        node_id.to_string(),
    );
    Ok(Some(upto_seq))
}
