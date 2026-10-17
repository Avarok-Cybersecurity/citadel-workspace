//! The reads: a page of the log, and the awareness relay, which reads nothing and stores
//! nothing.

use super::{answer, no_such_node, node_exists, refused, within, Answer};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::log::plan_pull;
use crate::kernel::documents::{DocumentsConfig, DocumentsRelay};
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::documents::{DocumentRefusal, DocumentSnapshot, DocumentsResponse};

pub(super) async fn pull<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    config: &DocumentsConfig,
    node_id: &str,
    since_seq: u64,
) -> Answer {
    let backend = &kernel.domain_operations.backend_tx_manager;
    // Held so a compaction cannot drop the updates this is reading.
    let _log = backend.lock_document(node_id).await;
    if !node_exists(kernel, node_id).await? {
        return no_such_node(node_id);
    }
    let head = backend.document_head(node_id).await?;
    let plan = plan_pull(&head, since_seq, config.max_updates_per_pull);
    let snapshot = if plan.with_snapshot {
        let stored = backend.document_snapshot(node_id).await?.ok_or_else(|| {
            NetworkError::msg(format!(
                "document {node_id} names a snapshot it does not hold"
            ))
        })?;
        Some(DocumentSnapshot {
            doc_version: stored.doc_version,
            bytes: stored.bytes,
            upto_seq: head.snapshot_upto,
        })
    } else {
        None
    };
    answer(DocumentsResponse::Updates {
        node_id: node_id.to_string(),
        snapshot,
        updates: backend.document_updates(node_id, plan.seqs).await?,
        has_more: plan.has_more,
        latest_seq: head.latest_seq,
    })
}

pub(super) async fn relay_awareness<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    requester_cid: Option<u64>,
    node_id: &str,
    payload: &[u8],
) -> Answer {
    let Some(from_cid) = requester_cid else {
        return refused(DocumentRefusal::NoSession);
    };
    if let Err((bytes, max_bytes)) = within(payload.len(), relay.config.max_awareness_bytes) {
        return refused(DocumentRefusal::AwarenessTooLarge {
            node_id: node_id.to_string(),
            size_bytes: bytes,
            max_bytes,
        });
    }
    if !relay
        .awareness_limiter
        .try_consume(from_cid, crate::platform::Instant::now())
    {
        return refused(DocumentRefusal::AwarenessRateLimited {
            node_id: node_id.to_string(),
        });
    }
    if !node_exists(kernel, node_id).await? {
        return no_such_node(node_id);
    }
    kernel.broadcast_to_node(
        WorkspaceProtocolResponse::Documents(DocumentsResponse::DocumentAwareness {
            node_id: node_id.to_string(),
            from_cid,
            payload: payload.to_vec(),
        }),
        Some(from_cid),
        node_id.to_string(),
    );
    answer(DocumentsResponse::AwarenessRelayed {
        node_id: node_id.to_string(),
    })
}
