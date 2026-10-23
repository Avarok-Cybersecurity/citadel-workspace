//! App storage at rest (`kernel::apps::storage`): KV values, each namespace's index, blobs in
//! chunks, and each root's ledger. Nothing is decided here; the caller holds `APPS_LOCK`.
//!
//! Values and chunks are stored as base64 text, as artifacts are (`apps_artifact_store`): a
//! Durable Object value is at most 2 MB.

use super::BackendTransactionManager;
use crate::kernel::apps::artifact::chunks;
use crate::kernel::apps::records::*;
use crate::kernel::apps::storage::{KvIndex, StorageLedger, StorageRoot};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_protocol::ARTIFACT_CHUNK_BYTES;

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
        Ok(self
            .backend_get(&ledger_key(&root.id()))
            .await?
            .unwrap_or_default())
    }

    pub(crate) async fn save_app_ledger(
        &self,
        root: &StorageRoot,
        ledger: &StorageLedger,
    ) -> Result<(), NetworkError> {
        let key = ledger_key(&root.id());
        if ledger.is_empty() {
            return self.backend_delete(&key).await;
        }
        self.backend_save(&key, ledger).await
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

    /// The meta first, so a reader never finds a blob with chunks missing.
    pub(crate) async fn delete_blob(
        &self,
        root: &StorageRoot,
        sha256: &str,
    ) -> Result<(), NetworkError> {
        let root_id = root.id();
        let meta: Option<ArtifactMeta> = self.backend_get(&blob_key(&root_id, sha256)).await?;
        let Some(meta) = meta else {
            return Ok(());
        };
        self.backend_delete(&blob_key(&root_id, sha256)).await?;
        for index in 0..meta.total_chunks {
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
        for sha256 in ledger.blobs.keys() {
            self.delete_blob(root, sha256).await?;
        }
        self.save_app_ledger(root, &StorageLedger::default())
            .await?;
        Ok(ledger.total_bytes())
    }
}
