//! App storage at rest (`kernel::apps::storage`): KV values, each namespace's index, blobs in
//! chunks, each root's ledger, and which roots hold anything. Nothing is decided here; the
//! caller holds `APPS_LOCK`.
//!
//! Values and chunks are stored as base64 text, as artifacts are (`apps_artifact_store`): a
//! Durable Object value is at most 2 MB.

use super::BackendTransactionManager;
use crate::kernel::apps::artifact::chunks;
use crate::kernel::apps::records::*;
use crate::kernel::apps::storage::{KvIndex, StorageLedger, StorageRoot};
use crate::kernel::apps::storage_write::chunk_count;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_protocol::ARTIFACT_CHUNK_BYTES;
use std::collections::BTreeSet;

fn decode(text: &str, key: &str) -> Result<Vec<u8>, NetworkError> {
    STANDARD
        .decode(text)
        .map_err(|e| NetworkError::msg(format!("{key} is not base64: {e}")))
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub(crate) async fn app_ledger(
        &self,
        root: &StorageRoot,
    ) -> Result<StorageLedger, NetworkError> {
        self.ledger_of(&root.id()).await
    }

    async fn ledger_of(&self, root_id: &str) -> Result<StorageLedger, NetworkError> {
        Ok(self
            .backend_get(&ledger_key(root_id))
            .await?
            .unwrap_or_default())
    }

    async fn storage_roots(&self) -> Result<BTreeSet<String>, NetworkError> {
        Ok(self
            .backend_get(&storage_roots_key())
            .await?
            .unwrap_or_default())
    }

    /// Save `root`'s ledger, and keep the set of roots holding anything in step with it: a
    /// root is entered before its ledger first names bytes, and left once its ledger is empty.
    pub(crate) async fn save_app_ledger(
        &self,
        root: &StorageRoot,
        ledger: &StorageLedger,
    ) -> Result<(), NetworkError> {
        let (root_id, mut roots) = (root.id(), self.storage_roots().await?);
        let key = ledger_key(&root_id);
        if ledger.is_empty() {
            self.backend_delete(&key).await?;
            if roots.remove(&root_id) {
                self.backend_save(&storage_roots_key(), &roots).await?;
            }
            return Ok(());
        }
        if roots.insert(root_id) {
            self.backend_save(&storage_roots_key(), &roots).await?;
        }
        self.backend_save(&key, ledger).await
    }

    /// Bytes every root but `root` holds: the rest of the workspace's app storage.
    pub(crate) async fn app_storage_besides(
        &self,
        root: &StorageRoot,
    ) -> Result<u64, NetworkError> {
        let own = root.id();
        let mut total = 0u64;
        for root_id in self.storage_roots().await?.iter().filter(|id| **id != own) {
            let held = self.ledger_of(root_id).await?.total_bytes();
            total = total.saturating_add(held);
        }
        Ok(total)
    }

    pub(crate) async fn kv_index(&self, namespace_id: &str) -> Result<KvIndex, NetworkError> {
        Ok(self
            .backend_get(&kv_index_key(namespace_id))
            .await?
            .unwrap_or_default())
    }

    pub(crate) async fn save_kv_index(
        &self,
        namespace_id: &str,
        index: &KvIndex,
    ) -> Result<(), NetworkError> {
        let key = kv_index_key(namespace_id);
        if index.keys.is_empty() {
            return self.backend_delete(&key).await;
        }
        self.backend_save(&key, index).await
    }

    pub(crate) async fn kv_value(
        &self,
        namespace_id: &str,
        key_id: &str,
    ) -> Result<Option<Vec<u8>>, NetworkError> {
        let key = kv_value_key(namespace_id, key_id);
        let text: Option<String> = self.backend_get(&key).await?;
        text.map(|text| decode(&text, &key)).transpose()
    }

    /// Write (`Some`) or delete (`None`) one value.
    pub(crate) async fn put_kv_value(
        &self,
        namespace_id: &str,
        key_id: &str,
        value: Option<&[u8]>,
    ) -> Result<(), NetworkError> {
        let key = kv_value_key(namespace_id, key_id);
        match value {
            Some(bytes) => self.backend_save(&key, &STANDARD.encode(bytes)).await,
            None => self.backend_delete(&key).await,
        }
    }

    /// Store a blob the caller verified hashes to `sha256`: chunks first, the meta last.
    pub(crate) async fn store_blob(
        &self,
        root: &StorageRoot,
        sha256: &str,
        bytes: &[u8],
    ) -> Result<(), NetworkError> {
        let root_id = root.id();
        let mut total_chunks = 0u32;
        for (index, chunk) in chunks(bytes).enumerate() {
            let index = u32::try_from(index).map_err(|_| NetworkError::msg("Too many chunks"))?;
            let key = blob_chunk_key(&root_id, sha256, index);
            self.backend_save(&key, &STANDARD.encode(chunk)).await?;
            total_chunks = index + 1;
        }
        let meta = ArtifactMeta {
            bytes: u32::try_from(bytes.len()).map_err(|_| NetworkError::msg("Too large"))?,
            chunk_bytes: ARTIFACT_CHUNK_BYTES,
            total_chunks,
        };
        self.backend_save(&blob_key(&root_id, sha256), &meta).await
    }

    pub(crate) async fn blob(
        &self,
        root: &StorageRoot,
        sha256: &str,
    ) -> Result<Option<Vec<u8>>, NetworkError> {
        let root_id = root.id();
        let meta: Option<ArtifactMeta> = self.backend_get(&blob_key(&root_id, sha256)).await?;
        let Some(meta) = meta else {
            return Ok(None);
        };
        let mut bytes = Vec::with_capacity(meta.bytes as usize);
        for index in 0..meta.total_chunks {
            let key = blob_chunk_key(&root_id, sha256, index);
            let text: String = self
                .backend_get(&key)
                .await?
                .ok_or_else(|| NetworkError::msg(format!("{key} is missing")))?;
            bytes.extend(decode(&text, &key)?);
        }
        Ok(Some(bytes))
    }

    /// Whether a blob's meta landed, which `store_blob` writes after every chunk.
    pub(crate) async fn blob_complete(
        &self,
        root: &StorageRoot,
        sha256: &str,
    ) -> Result<bool, NetworkError> {
        let meta: Option<ArtifactMeta> = self.backend_get(&blob_key(&root.id(), sha256)).await?;
        Ok(meta.is_some())
    }

    /// Delete a blob of `len` bytes, as its ledger records it: the meta first, so a reader never
    /// finds a blob with chunks missing, then every chunk its length says it was stored in,
    /// whether or not its meta ever landed.
    pub(crate) async fn delete_blob(
        &self,
        root: &StorageRoot,
        sha256: &str,
        len: u64,
    ) -> Result<(), NetworkError> {
        let root_id = root.id();
        self.backend_delete(&blob_key(&root_id, sha256)).await?;
        for index in 0..chunk_count(len) {
            self.backend_delete(&blob_chunk_key(&root_id, sha256, index))
                .await?;
        }
        Ok(())
    }

    /// Delete everything `root` holds: every namespace's values and index, every blob, then the
    /// ledger. Answers how many bytes were freed.
    pub(crate) async fn purge_app_storage(&self, root: &StorageRoot) -> Result<u64, NetworkError> {
        let ledger = self.app_ledger(root).await?;
        for namespace_id in ledger.namespaces.keys() {
            let index = self.kv_index(namespace_id).await?;
            for key in index.keys.keys() {
                let key_id = crate::kernel::apps::storage::key_id(key);
                self.put_kv_value(namespace_id, &key_id, None).await?;
            }
            self.save_kv_index(namespace_id, &KvIndex::default())
                .await?;
        }
        for (sha256, len) in &ledger.blobs {
            self.delete_blob(root, sha256, *len).await?;
        }
        self.save_app_ledger(root, &StorageLedger::default())
            .await?;
        Ok(ledger.total_bytes())
    }
}
