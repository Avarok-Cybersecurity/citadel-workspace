//! Reclaiming the space node chat files no longer need (`kernel::chat_attachments`), so it is not
//! held indefinitely: uploads nobody shared within `UNSHARED_GRACE_MS`, bytes a store left
//! without an index entry (stopped between the ledger and the index), and index entries whose
//! bytes are gone (a delete stopped between the bytes and the index).
//!
//! One node's sweep (`sweep_node`) runs on every upload to that node, before the upload is
//! counted, and on a timer the host runs: the native server's hourly purge loop (`lib.rs`) and a
//! hosted tenant's Durable Object alarm (`deploy/tenant-worker`), the same places expired secure
//! links are purged. Each timed pass visits at most `max_nodes` nodes after the last one visited,
//! so one pass's work is bounded however many nodes hold files; the host runs the next pass soon
//! while a round has nodes left.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::chat_attachments::{root_of, AttachmentIndex};
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::kernel::transaction::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::BTreeSet;
use std::ops::Bound;

/// How many nodes one timed pass visits at most. A node's sweep reads its index and ledger and
/// deletes what it reclaims, so this keeps one alarm's work, and how long it holds `APPS_LOCK`
/// in total, bounded.
pub const SWEEP_BATCH: u32 = 50;

/// How often a host sweeps: hourly, the grace itself, so an abandoned upload is held at most
/// about twice the grace when nobody uploads to its node again.
pub const SWEEP_INTERVAL_MS: u64 = crate::kernel::chat_attachments::UNSHARED_GRACE_MS;

/// The nodes after `cursor` (from the first when none) that one pass of at most `max` visits,
/// and how many of `nodes` remain after them in this round.
pub fn sweep_batch(nodes: &BTreeSet<String>, cursor: Option<&str>, max: u32) -> (Vec<String>, u32) {
    let after = match cursor {
        Some(cursor) => nodes.range::<str, _>((Bound::Excluded(cursor), Bound::Unbounded)),
        None => nodes.range::<str, _>(..),
    };
    let mut after = after.cloned();
    let batch: Vec<String> = after.by_ref().take(max as usize).collect();
    (batch, after.count() as u32)
}

/// With `APPS_LOCK` held: sweeps `node_id` at `now_ms` and answers its index as it is after.
pub(crate) async fn sweep_node<R: Ratchet + Send + Sync + 'static>(
    backend: &BackendTransactionManager<R>,
    node_id: &str,
    now_ms: u64,
) -> Result<AttachmentIndex, NetworkError> {
    let mut index = backend.chat_attachment_index(node_id).await?;
    let root = root_of(node_id);
    let ledger = backend.app_ledger(&root).await?;
    let plan = index.sweep(&ledger.blobs, now_ms);
    if plan.is_empty() {
        return Ok(index);
    }
    backend.drop_chat_attachments(node_id, &plan.drop).await?;
    for id in &plan.forget {
        index.files.remove(id);
    }
    backend.save_chat_attachment_index(node_id, &index).await?;
    if index.files.is_empty() && backend.app_ledger(&root).await?.is_empty() {
        backend.forget_chat_attachment_node(node_id).await?;
    }
    Ok(index)
}

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// Sweeps at most `max_nodes` nodes' chat files as of `now_ms` (Unix ms, the host's clock),
    /// continuing from the last pass. Answers how many nodes this round has left, 0 when it is
    /// done (the next pass starts a new round). Each node is swept under `APPS_LOCK`, taken per
    /// node so uploads interleave with a pass.
    pub async fn sweep_chat_attachments(
        &self,
        now_ms: u64,
        max_nodes: u32,
    ) -> Result<u32, NetworkError> {
        let backend = &self.domain_operations.backend_tx_manager;
        let (batch, remaining) = {
            let _guard = APPS_LOCK.lock().await;
            let nodes = backend.chat_attachment_nodes().await?;
            let cursor = backend.chat_attachment_sweep_cursor().await?;
            sweep_batch(&nodes, cursor.as_deref(), max_nodes)
        };
        for node_id in &batch {
            let _guard = APPS_LOCK.lock().await;
            sweep_node(backend, node_id, now_ms).await?;
        }
        let _guard = APPS_LOCK.lock().await;
        let cursor = batch.last().filter(|_| remaining > 0);
        backend
            .save_chat_attachment_sweep_cursor(cursor.map(String::as_str))
            .await?;
        Ok(remaining)
    }
}
