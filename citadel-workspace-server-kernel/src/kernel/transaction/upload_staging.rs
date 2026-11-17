//! One chunk of a member's upload into its staging slot (`records::UploadSlot`), the step an app
//! artifact and a chat file share: chunks may arrive in any order and more than once, a different
//! upload replaces the one in progress, and the whole is checked against its digest once every
//! chunk is in. The caller holds the lock its slot's writes are serialised under.

use super::BackendTransactionManager;
use crate::kernel::apps::records::{UploadSlot, UploadStaging};
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
}
