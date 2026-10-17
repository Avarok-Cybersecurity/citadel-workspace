//! The two writes: an append, and the snapshot that compacts the log.

use super::{answer, no_such_node, node_exists, refused, Answer};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::log::{compacted, compaction_due, plan_snapshot, SnapshotConflict};
use crate::kernel::documents::DocumentsConfig;
use crate::kernel::transaction::documents_store::StoredSnapshot;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::documents::{
    CompactionRequested, DocumentRefusal, DocumentUpdate, DocumentsResponse,
};

/// An update as its writer sent it, before the log numbers it.
pub(super) struct Written<'a> {
    pub(super) doc_version: u32,
    pub(super) update: &'a [u8],
    pub(super) author_cid: u64,
    pub(super) client_seq: u64,
}

pub(super) async fn append<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    config: &DocumentsConfig,
    node_id: &str,
    written: Written<'_>,
) -> Answer {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _log = backend.lock_document(node_id).await;
    if !node_exists(kernel, node_id).await? {
        return no_such_node(node_id);
    }
    let head = backend.document_head(node_id).await?.appended();
    let entry = DocumentUpdate {
        seq: head.latest_seq,
        doc_version: written.doc_version,
        update: written.update.to_vec(),
        author_cid: written.author_cid,
    };
    // The update before the head that counts it: a failure between the two leaves an update
    // nobody was told of, which the next append overwrites, never a head naming a missing one.
    backend.save_document_update(node_id, &entry).await?;
    backend.save_document_head(node_id, &head).await?;

    let author_cid = entry.author_cid;
    kernel.broadcast_to_node(
        WorkspaceProtocolResponse::Documents(DocumentsResponse::DocumentUpdated {
            node_id: node_id.to_string(),
            seq: entry.seq,
            doc_version: entry.doc_version,
            update: entry.update,
            author_cid,
        }),
        Some(author_cid),
        node_id.to_string(),
    );
    answer(DocumentsResponse::Appended {
        node_id: node_id.to_string(),
        seq: head.latest_seq,
        client_seq: written.client_seq,
        compaction: compaction_due(&head, config.snapshot_min_updates).map(|pending| {
            CompactionRequested {
                node_id: node_id.to_string(),
                pending,
            }
        }),
    })
}

pub(super) async fn store_snapshot<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    node_id: &str,
    snapshot: StoredSnapshot,
    upto_seq: u64,
) -> Answer {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _log = backend.lock_document(node_id).await;
    if !node_exists(kernel, node_id).await? {
        return no_such_node(node_id);
    }
    let head = backend.document_head(node_id).await?;
    let (covering, dropped) = match plan_snapshot(&head, upto_seq) {
        Ok(plan) => plan,
        Err(SnapshotConflict::Ahead { latest_seq }) => {
            return refused(DocumentRefusal::SnapshotAhead {
                node_id: node_id.to_string(),
                upto_seq,
                latest_seq,
            })
        }
        Err(SnapshotConflict::Behind { stored_upto_seq }) => {
            return refused(DocumentRefusal::SnapshotBehind {
                node_id: node_id.to_string(),
                upto_seq,
                stored_upto_seq,
            })
        }
    };
    // Snapshot, then the head that says it covers `upto_seq`, then the drop. Stopped after the
    // first, a reader gets the new snapshot and updates it already holds, which merge as no-ops;
    // after the second, the head still names the undropped updates, so nothing is leaked.
    backend.save_document_snapshot(node_id, &snapshot).await?;
    backend.save_document_head(node_id, &covering).await?;
    backend.drop_document_updates(node_id, dropped).await?;
    backend
        .save_document_head(node_id, &compacted(&covering))
        .await?;
    answer(DocumentsResponse::SnapshotStored {
        node_id: node_id.to_string(),
        upto_seq,
    })
}
