//! One chunk of a member's upload into its staging slot (`records::UploadSlot`), the step an app
//! artifact and a chat file share: chunks may arrive in any order and more than once, a different
//! upload replaces the one in progress, and the whole is checked against its digest once every
//! chunk is in. The caller holds the lock its slot's writes are serialised under.
//!
//! Beside it, what the chat-file and the document-picture uploads share around that step: the
//! bytes an upload in progress reserves toward the workspace's storage (each kind's own staging
//! root, one namespace per member), and keeping a verified whole as a blob under its root.

use super::BackendTransactionManager;
use crate::kernel::apps::records::{UploadSlot, UploadStaging};
use crate::kernel::apps::storage::{Namespace, StorageRoot};
use citadel_app_signature::sha256;
use citadel_sdk::prelude::{NetworkError, Ratchet};

/// What staging one chunk came to.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Staged {
    /// Chunks are still missing.
    Partial,
    /// Every chunk is in and the whole hashes to its digest. `whole` is the bytes when this chunk
    /// completed it, and `None` when an earlier one had.
    Complete { whole: Option<Vec<u8>> },
    /// Every chunk is in and the whole does not hash to its digest; the slot is emptied.
    Mismatch,
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Stage chunk `index` of `total_chunks` of the upload whose SHA-256 is `sha256_hex`, a shape
    /// the caller has checked.
    pub(crate) async fn stage_upload_chunk(
        &self,
        slot: UploadSlot<'_>,
        sha256_hex: &str,
        index: u32,
        total_chunks: u32,
        bytes: &[u8],
    ) -> Result<Staged, NetworkError> {
        let mut staging = match self.app_upload(slot).await? {
            Some(staging)
                if staging.sha256 == sha256_hex && staging.total_chunks == total_chunks =>
            {
                staging
            }
            // One upload per slot: a different one replaces the one in progress.
            _ => {
                self.drop_app_upload(slot).await?;
                UploadStaging {
                    sha256: sha256_hex.to_string(),
                    total_chunks,
                    received: Default::default(),
                    complete: false,
                }
            }
        };
        if staging.complete {
            return Ok(Staged::Complete { whole: None });
        }
        self.save_app_upload_chunk(slot, index, bytes).await?;
        staging.received.insert(index);
        self.save_app_upload(slot, &staging).await?;
        if staging.received.len() as u32 != total_chunks {
            return Ok(Staged::Partial);
        }
        let whole = self.assemble_app_upload(slot, &staging).await?;
        let Some(whole) = whole.filter(|whole| hex::encode(sha256(whole)) == sha256_hex) else {
            self.drop_app_upload(slot).await?;
            return Ok(Staged::Mismatch);
        };
        staging.complete = true;
        self.save_app_upload(slot, &staging).await?;
        Ok(Staged::Complete { whole: Some(whole) })
    }

    /// The whole of the upload in `slot` when an earlier chunk already completed it (a client
    /// sending its last chunk again).
    pub(crate) async fn completed_upload(
        &self,
        slot: UploadSlot<'_>,
    ) -> Result<Vec<u8>, NetworkError> {
        let staging = self.app_upload(slot).await?;
        match staging {
            Some(staging) => self.assemble_app_upload(slot, &staging).await?,
            None => None,
        }
        .ok_or_else(|| NetworkError::msg("a complete upload lost a chunk"))
    }

    /// The bytes every member's upload in progress under `staging` reserves, and `actor`'s share.
    pub(crate) async fn staging_reserved(
        &self,
        staging: &StorageRoot,
        actor: &str,
    ) -> Result<(u64, u64), NetworkError> {
        let ledger = self.app_ledger(staging).await?;
        let mine = staging.namespace_id(&Namespace::User(actor.to_string()));
        let own = ledger.namespaces.get(&mine).copied().unwrap_or(0);
        Ok((ledger.total_bytes(), own))
    }

    /// Records that `actor`'s upload in progress under `staging` reserves `bytes` (`None`: none).
    pub(crate) async fn reserve_staging(
        &self,
        staging: &StorageRoot,
        actor: &str,
        bytes: Option<u64>,
    ) -> Result<(), NetworkError> {
        let mut ledger = self.app_ledger(staging).await?;
        let mine = staging.namespace_id(&Namespace::User(actor.to_string()));
        match bytes {
            Some(bytes) => ledger.namespaces.insert(mine, bytes),
            None => ledger.namespaces.remove(&mine),
        };
        self.save_app_ledger(staging, &ledger).await
    }

    /// Store `bytes`, whose SHA-256 the caller verified is `id`, as a blob of `root`: in its
    /// ledger first, then the chunks, so a store that fails part way leaves nothing a purge of the
    /// root cannot find. A blob the root already holds whole is left as it is.
    pub(crate) async fn keep_blob(
        &self,
        root: &StorageRoot,
        id: &str,
        bytes: &[u8],
    ) -> Result<(), NetworkError> {
        let mut ledger = self.app_ledger(root).await?;
        if !ledger.blobs.contains_key(id) {
            ledger.blobs.insert(id.to_string(), bytes.len() as u64);
            self.save_app_ledger(root, &ledger).await?;
        } else if self.blob_complete(root, id).await? {
            return Ok(());
        }
        self.store_blob(root, id, bytes).await
    }
}
