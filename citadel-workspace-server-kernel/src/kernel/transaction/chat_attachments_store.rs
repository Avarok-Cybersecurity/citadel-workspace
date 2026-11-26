//! A node's chat files at rest (`kernel::chat_attachments`): the index beside the app-storage
//! root that holds their bytes. Nothing is decided here; the caller holds `APPS_LOCK`, which every
//! write to a storage root's ledger is made under.
//!
//! - `citadel_workspace.chat_attachments.<node id>`: the node's `AttachmentIndex`.
//! - `citadel_workspace.chat_attachment_nodes`: every node whose ledger or index may hold
//!   anything, entered before its ledger first names bytes, so the sweep can find each one.
//! - `citadel_workspace.chat_attachment_sweep_cursor`: the last node the sweep visited.
//! - The bytes: `chat_attachments::root_of(node)`'s blobs and ledger (`apps_kv_store`).
//!
//! Bytes are only written under a ledger that already names them, as app blobs are, so a store
//! that fails part way leaves nothing the node's purge, or the sweep, cannot find.

use super::BackendTransactionManager;
use crate::kernel::chat_attachments::{root_of, AttachmentIndex};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::BTreeSet;

fn index_key(node_id: &str) -> String {
    format!("citadel_workspace.chat_attachments.{node_id}")
}

const NODES_KEY: &str = "citadel_workspace.chat_attachment_nodes";
const SWEEP_CURSOR_KEY: &str = "citadel_workspace.chat_attachment_sweep_cursor";

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub(crate) async fn chat_attachment_index(
        &self,
        node_id: &str,
    ) -> Result<AttachmentIndex, NetworkError> {
        Ok(self
            .backend_get(&index_key(node_id))
            .await?
            .unwrap_or_default())
    }

    pub(crate) async fn save_chat_attachment_index(
        &self,
        node_id: &str,
        index: &AttachmentIndex,
    ) -> Result<(), NetworkError> {
        if index.files.is_empty() {
            return self.backend_delete(&index_key(node_id)).await;
        }
        self.backend_save(&index_key(node_id), index).await
    }

    /// Store `bytes`, whose SHA-256 the caller verified is `id`, as one of `node_id`'s files: in
    /// its ledger first, then the chunks. A file the node already holds whole is left as it is.
    pub(crate) async fn store_chat_attachment(
        &self,
        node_id: &str,
        id: &str,
        bytes: &[u8],
    ) -> Result<(), NetworkError> {
        let mut nodes = self.chat_attachment_nodes().await?;
        if nodes.insert(node_id.to_string()) {
            self.backend_save(NODES_KEY, &nodes).await?;
        }
        self.keep_blob(&root_of(node_id), id, bytes).await
    }

    /// Delete `files` (id, size) of `node_id`'s: each file's bytes, then the ledger without them.
    pub(crate) async fn drop_chat_attachments(
        &self,
        node_id: &str,
        files: &[(String, u64)],
    ) -> Result<(), NetworkError> {
        if files.is_empty() {
            return Ok(());
        }
        let root = root_of(node_id);
        let mut ledger = self.app_ledger(&root).await?;
        for (id, size_bytes) in files {
            self.delete_blob(&root, id, *size_bytes).await?;
            ledger.blobs.remove(id);
        }
        self.save_app_ledger(&root, &ledger).await
    }

    /// Delete every file `node_id` holds and its index: what deleting the node does. The ledger
    /// names every byte stored, so this reaches files whose index entry never landed.
    pub(crate) async fn purge_chat_attachments(&self, node_id: &str) -> Result<(), NetworkError> {
        self.purge_app_storage(&root_of(node_id)).await?;
        self.backend_delete(&index_key(node_id)).await?;
        self.forget_chat_attachment_node(node_id).await
    }

    /// Every node whose files the sweep visits.
    pub(crate) async fn chat_attachment_nodes(&self) -> Result<BTreeSet<String>, NetworkError> {
        Ok(self.backend_get(NODES_KEY).await?.unwrap_or_default())
    }

    /// Drops `node_id` from the sweep's nodes, once it holds nothing.
    pub(crate) async fn forget_chat_attachment_node(
        &self,
        node_id: &str,
    ) -> Result<(), NetworkError> {
        let mut nodes = self.chat_attachment_nodes().await?;
        if nodes.remove(node_id) {
            self.backend_save(NODES_KEY, &nodes).await?;
        }
        Ok(())
    }

    pub(crate) async fn chat_attachment_sweep_cursor(
        &self,
    ) -> Result<Option<String>, NetworkError> {
        self.backend_get(SWEEP_CURSOR_KEY).await
    }

    pub(crate) async fn save_chat_attachment_sweep_cursor(
        &self,
        cursor: Option<&str>,
    ) -> Result<(), NetworkError> {
        match cursor {
            Some(node_id) => self.backend_save(SWEEP_CURSOR_KEY, &node_id).await,
            None => self.backend_delete(SWEEP_CURSOR_KEY).await,
        }
    }
}
