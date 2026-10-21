//! Where a document node's update log lives: a head, one key per update, and the snapshot.
//!
//! One key per update rather than pages: on the SQL backend production runs, a write costs the
//! size of the value, so an append writes its update and the head and nothing else, and a
//! compaction deletes exactly the updates it folded in.
//!
//! Every read-modify-write of a log holds that log's lock (`lock_document`), and the node
//! delete holds the locks of every node it removes across the purge AND the tree save
//! (`lock_documents`). An append checks the node still exists under its lock, so it either
//! lands before the purge and is purged with it, or finds the node gone: a log cannot be
//! re-created after its node is deleted.

use super::{group_stripe, BackendTransactionManager};
use crate::kernel::documents::log::LogHead;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::documents::DocumentUpdate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::ops::RangeInclusive;
use tokio::sync::OwnedMutexGuard;

fn head_key(node_id: &str) -> String {
    format!("citadel_workspace.documents.{node_id}.head")
}

fn update_key(node_id: &str, seq: u64) -> String {
    format!("citadel_workspace.documents.{node_id}.update.{seq}")
}

fn snapshot_key(node_id: &str) -> String {
    format!("citadel_workspace.documents.{node_id}.snapshot")
}

/// The snapshot's bytes, and who stored it when. What it covers is the head's `snapshot_upto`,
/// the one record of it.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredSnapshot {
    pub doc_version: u32,
    pub bytes: Vec<u8>,
    pub stored_by: SnapshotAuthor,
    /// When, in milliseconds since the Unix epoch.
    pub stored_at_ms: u64,
}

/// Who stored a snapshot.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapshotAuthor {
    /// A writer's session, by CID, through `StoreSnapshot`.
    Session(u64),
    /// The server, compacting the log itself.
    Server,
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Hold across any read-modify-write of `node_id`'s log.
    pub(crate) async fn lock_document(&self, node_id: &str) -> OwnedMutexGuard<()> {
        self.document_mutex[group_stripe(node_id)]
            .clone()
            .lock_owned()
            .await
    }

    /// The locks of every log in `node_ids`, each stripe once and in ascending order, so two
    /// holders cannot wait on each other and a stripe two nodes share is not locked twice.
    pub(crate) async fn lock_documents(&self, node_ids: &[String]) -> Vec<OwnedMutexGuard<()>> {
        let stripes: BTreeSet<usize> = node_ids.iter().map(|id| group_stripe(id)).collect();
        let mut guards = Vec::with_capacity(stripes.len());
        for stripe in stripes {
            guards.push(self.document_mutex[stripe].clone().lock_owned().await);
        }
        guards
    }

    pub(crate) async fn document_head(&self, node_id: &str) -> Result<LogHead, NetworkError> {
        Ok(self
            .backend_get(&head_key(node_id))
            .await?
            .unwrap_or(LogHead::EMPTY))
    }

    pub(crate) async fn save_document_head(
        &self,
        node_id: &str,
        head: &LogHead,
    ) -> Result<(), NetworkError> {
        self.backend_save(&head_key(node_id), head).await
    }

    pub(crate) async fn save_document_update(
        &self,
        node_id: &str,
        update: &DocumentUpdate,
    ) -> Result<(), NetworkError> {
        self.backend_save(&update_key(node_id, update.seq), update)
            .await
    }

    /// Every update in `seqs`, in order. One the head says is held and the store lacks is an
    /// error, not a gap: a reader handed a log with a hole merges a document that never existed.
    pub(crate) async fn document_updates(
        &self,
        node_id: &str,
        seqs: RangeInclusive<u64>,
    ) -> Result<Vec<DocumentUpdate>, NetworkError> {
        let mut updates = Vec::new();
        for seq in seqs {
            let update: DocumentUpdate = self
                .backend_get(&update_key(node_id, seq))
                .await?
                .ok_or_else(|| {
                    NetworkError::msg(format!("document {node_id} is missing update {seq}"))
                })?;
            updates.push(update);
        }
        Ok(updates)
    }

    pub(crate) async fn document_snapshot(
        &self,
        node_id: &str,
    ) -> Result<Option<StoredSnapshot>, NetworkError> {
        self.backend_get(&snapshot_key(node_id)).await
    }

    pub(crate) async fn save_document_snapshot(
        &self,
        node_id: &str,
        snapshot: &StoredSnapshot,
    ) -> Result<(), NetworkError> {
        self.backend_save(&snapshot_key(node_id), snapshot).await
    }

    pub(crate) async fn drop_document_updates(
        &self,
        node_id: &str,
        seqs: RangeInclusive<u64>,
    ) -> Result<(), NetworkError> {
        for seq in seqs {
            self.backend_delete(&update_key(node_id, seq)).await?;
        }
        Ok(())
    }

    /// Drop `node_id`'s whole log. The caller holds its lock. The head goes last, so a delete
    /// that fails part way still knows, on the retry, which updates are left.
    pub(crate) async fn delete_document_log(&self, node_id: &str) -> Result<(), NetworkError> {
        let head = self.document_head(node_id).await?;
        self.drop_document_updates(node_id, head.stored()).await?;
        self.backend_delete(&snapshot_key(node_id)).await?;
        self.backend_delete(&head_key(node_id)).await
    }
}
