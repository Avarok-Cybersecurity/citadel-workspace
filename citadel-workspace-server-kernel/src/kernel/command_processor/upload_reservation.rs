//! Reserving room toward the workspace's storage for a member's upload in progress, the step a
//! chat file's upload (`chat_attachments`) and a document picture's (`document_pictures`) share.
//! The caller holds `APPS_LOCK`.

use super::apps_call_storage_write::{storage_admission, StorageAdmission};
use crate::kernel::apps::records::UploadSlot;
use crate::kernel::apps::storage::StorageRoot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};

/// When this chunk starts `actor`'s upload of `sha256` in `slot` (rather than continuing it):
/// reserves its `size_bytes` under `staging`, in place of whatever their last upload in progress
/// there reserved. A member stages one upload of a kind at a time, so what one member can reserve
/// is one file of each kind, and what every member reserves together is what the workspace's
/// storage admits. Anything but `Fits` reserved nothing.
pub(super) async fn reserve_upload<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    slot: UploadSlot<'_>,
    staging: &StorageRoot,
    actor: &str,
    sha256: &str,
    total_chunks: u32,
    size_bytes: u64,
) -> Result<StorageAdmission, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let in_progress = backend.app_upload(slot).await?;
    if matches!(&in_progress, Some(s) if s.sha256 == sha256 && s.total_chunks == total_chunks) {
        return Ok(StorageAdmission::Fits);
    }
    let (reserved, mine) = backend.staging_reserved(staging, actor).await?;
    let next = reserved.saturating_sub(mine).saturating_add(size_bytes);
    let admission = storage_admission(kernel, staging, reserved, next).await?;
    if matches!(admission, StorageAdmission::Fits) {
        backend
            .reserve_staging(staging, actor, Some(size_bytes))
            .await?;
    }
    Ok(admission)
}
