//! The two storage decisions of a chat upload (`chat_attachments`), both made with `APPS_LOCK`
//! held: reserving room for the upload in progress, and keeping the whole once it is in.

use super::apps_call_storage_write::{storage_admission, StorageAdmission};
use crate::kernel::apps::records::UploadSlot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::chat_attachment_sweep::sweep_node;
use crate::kernel::chat_attachments::{root_of, staging_root};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::chat_attachments::ChatAttachmentRefusal as Refusal;

fn admitted(admission: StorageAdmission) -> Result<(), Refusal> {
    match admission {
        StorageAdmission::Fits => Ok(()),
        StorageAdmission::Over(_) => Err(Refusal::StorageFull),
        StorageAdmission::Unknown => Err(Refusal::Unavailable),
    }
}

/// When this chunk starts `actor`'s upload of `sha256` (rather than continuing it): reserves its
/// `size_bytes` toward the workspace's storage, in place of whatever their last upload in
/// progress reserved. A member stages one upload at a time, so what one member can reserve is
/// one file, and what every member reserves together is what the workspace's storage admits.
pub(super) async fn reserve<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    sha256: &str,
    total_chunks: u32,
    size_bytes: u64,
) -> Result<Result<(), Refusal>, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let in_progress = backend
        .app_upload(UploadSlot::ChatAttachment(actor))
        .await?;
    if matches!(&in_progress, Some(s) if s.sha256 == sha256 && s.total_chunks == total_chunks) {
        return Ok(Ok(()));
    }
    let (reserved, mine) = backend.chat_staging_reserved(actor).await?;
    let next = reserved.saturating_sub(mine).saturating_add(size_bytes);
    if let Err(refusal) =
        admitted(storage_admission(kernel, &staging_root(), reserved, next).await?)
    {
        return Ok(Err(refusal));
    }
    backend
        .reserve_chat_staging(actor, Some(size_bytes))
        .await?;
    Ok(Ok(()))
}

/// Sweeps the node (`sweep_node`), then keeps `whole` as `id`, uploaded by `actor`, within the
/// node's `max_files` and the workspace's storage.
pub(super) async fn keep<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    node_id: &str,
    id: &str,
    whole: &[u8],
    max_files: u32,
) -> Result<Result<(), Refusal>, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let now_ms = crate::platform::SystemTime::now()
        .duration_since(crate::platform::UNIX_EPOCH)
        .map_err(|e| NetworkError::msg(format!("the clock is before 1970: {e}")))?
        .as_millis() as u64;
    let mut index = sweep_node(backend, node_id, now_ms).await?;
    if let Err(refusal) = index.record_upload(id, whole.len() as u64, actor, now_ms, max_files) {
        return Ok(Err(refusal));
    }
    let root = root_of(node_id);
    let current = backend.app_ledger(&root).await?.total_bytes();
    let next = current.saturating_add(whole.len() as u64);
    if let Err(refusal) = admitted(storage_admission(kernel, &root, current, next).await?) {
        return Ok(Err(refusal));
    }
    backend.store_chat_attachment(node_id, id, whole).await?;
    backend.save_chat_attachment_index(node_id, &index).await?;
    Ok(Ok(()))
}
