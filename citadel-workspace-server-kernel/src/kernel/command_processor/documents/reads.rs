//! The reads: a page of the log, and the awareness relay, which reads nothing and stores
//! nothing.

use super::target::Target;
use super::{node_exists, within, Answer};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::log::plan_pull;
use crate::kernel::documents::DocumentsRelay;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::documents::{DocumentRefusal, DocumentSnapshot, DocumentsResponse};

pub(super) async fn pull<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    requester_cid: Option<u64>,
    target: &Target,
    since_seq: u64,
) -> Answer {
    let node_id = target.node_id();
    let doc = target.doc();
    let Some(reader_cid) = requester_cid else {
        return target.refused(DocumentRefusal::NoSession);
    };
    if !relay
        .pull_limiter
        .try_consume(reader_cid, crate::platform::Instant::now())
    {
        return target.refused(DocumentRefusal::PullRateLimited {
            node_id: node_id.to_string(),
        });
    }
    let backend = &kernel.domain_operations.backend_tx_manager;
    // Held so a compaction cannot drop the updates this is reading.
    let _log = backend.lock_document(node_id).await;
    if !node_exists(kernel, node_id).await? {
        return target.no_such_node();
    }
    let head = backend.document_head(doc).await?;
    let plan = plan_pull(&head, since_seq, relay.config.max_updates_per_pull);
    let snapshot = if plan.with_snapshot {
        let stored = backend.document_snapshot(doc).await?.ok_or_else(|| {
            NetworkError::msg(format!("{doc:?} names a snapshot it does not hold"))
        })?;
        Some(DocumentSnapshot {
            doc_version: stored.doc_version,
            bytes: stored.bytes,
            upto_seq: head.snapshot_upto,
        })
    } else {
        None
    };
    target.answer(DocumentsResponse::Updates {
        node_id: node_id.to_string(),
        snapshot,
        updates: backend.document_updates(doc, plan.seqs).await?,
        has_more: plan.has_more,
        latest_seq: head.latest_seq,
    })
}

pub(super) async fn relay_awareness<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    requester_cid: Option<u64>,
    target: &Target,
    payload: &[u8],
) -> Answer {
    let node_id = target.node_id();
    let Some(from_cid) = requester_cid else {
        return target.refused(DocumentRefusal::NoSession);
    };
    if let Err((bytes, max_bytes)) = within(payload.len(), relay.config.max_awareness_bytes) {
        return target.refused(DocumentRefusal::AwarenessTooLarge {
            node_id: node_id.to_string(),
            size_bytes: bytes,
            max_bytes,
        });
    }
    if !relay
        .awareness_limiter
        .try_consume(from_cid, crate::platform::Instant::now())
    {
        return target.refused(DocumentRefusal::AwarenessRateLimited {
            node_id: node_id.to_string(),
        });
    }
    if !node_exists(kernel, node_id).await? {
        return target.no_such_node();
    }
    target.announce(
        kernel,
        DocumentsResponse::DocumentAwareness {
            node_id: node_id.to_string(),
            from_cid,
            payload: payload.to_vec(),
        },
        Some(from_cid),
    );
    target.answer(DocumentsResponse::AwarenessRelayed {
        node_id: node_id.to_string(),
    })
}
