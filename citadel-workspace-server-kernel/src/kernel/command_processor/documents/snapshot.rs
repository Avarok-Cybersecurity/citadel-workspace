//! A writer's `StoreSnapshot`: refused unless its session, size and bytes are sound, then
//! committed as the server's own compaction is (`commit`).

use super::commit::{commit, now_ms};
use super::{answer, refused, within, Answer};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::crdt::snapshot_clocks;
use crate::kernel::documents::DocumentsRelay;
use crate::kernel::transaction::documents_store::{SnapshotAuthor, StoredSnapshot};
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsResponse};

/// A snapshot as its writer sent it.
pub(super) struct Offered<'a> {
    pub(super) doc_version: u32,
    pub(super) snapshot: &'a [u8],
    pub(super) upto_seq: u64,
}

pub(super) async fn store_snapshot<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    requester_cid: Option<u64>,
    node_id: &str,
    offered: Offered<'_>,
) -> Answer {
    let Some(stored_by) = requester_cid else {
        return refused(DocumentRefusal::NoSession);
    };
    let upto_seq = offered.upto_seq;
    let config = &relay.config;
    if let Err((bytes, max_bytes)) = within(offered.snapshot.len(), config.max_snapshot_bytes) {
        return refused(DocumentRefusal::SnapshotTooLarge {
            node_id: node_id.to_string(),
            size_bytes: bytes,
            max_bytes,
        });
    }
    let held = match snapshot_clocks(offered.snapshot) {
        Ok(held) => held,
        Err(reason) => {
            return refused(DocumentRefusal::SnapshotMalformed {
                node_id: node_id.to_string(),
                reason,
            })
        }
    };

    let stored = StoredSnapshot {
        doc_version: offered.doc_version,
        bytes: offered.snapshot.to_vec(),
        stored_by: SnapshotAuthor::Session(stored_by),
        stored_at_ms: now_ms()?,
    };
    match commit(kernel, relay, node_id, stored, &held, upto_seq).await? {
        Ok(()) => answer(DocumentsResponse::SnapshotStored {
            node_id: node_id.to_string(),
            upto_seq,
        }),
        Err(refusal) => refused(refusal),
    }
}
