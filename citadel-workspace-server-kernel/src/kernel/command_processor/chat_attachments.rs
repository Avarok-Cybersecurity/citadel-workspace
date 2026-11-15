//! `ChatAttachments`: uploading a file to a node's chat and reading one back
//! (`citadel_workspace_types::chat_attachments`, `kernel::chat_attachments`).
//!
//! Both ask the channel's gate first (`authorize_node_channel`): uploading needs `CHANNEL_WRITE`,
//! reading `CHANNEL_READ`, and a node with its chat off has no files. A file not shared yet is
//! readable only by whoever uploaded it. Every way of failing those is `Denied`.
//!
//! An upload is staged chunk by chunk in the member's one chat-upload slot; the chunk that
//! completes it is checked against its id, counted toward the workspace's storage as if it were
//! new (so whether the node already holds those bytes is not told by the quota), and stored. All
//! of that is under `APPS_LOCK`, which every storage root's ledger is written under and which a
//! node delete holds across its purge, so the gate is asked again once the lock is held: a file
//! is never stored for a node already deleted.

use super::apps_call_storage_write::{storage_admission, StorageAdmission};
use crate::kernel::apps::records::UploadSlot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::chat_attachments::root_of;
use crate::kernel::group_access::authorize_node_channel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::kernel::transaction::upload_staging::Staged;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::chat_attachments::{
    check_upload_chunk, is_attachment_id, ChatAttachmentRefusal as Refusal, ChatAttachmentsRequest,
    ChatAttachmentsResponse as Response,
};
use citadel_workspace_types::chat_documents::{CHANNEL_READ, CHANNEL_WRITE};
use citadel_workspace_types::WorkspaceProtocolResponse;

type Outcome = Result<Response, Refusal>;

pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    request: &ChatAttachmentsRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let (node_id, attachment_id, outcome) = match request {
        ChatAttachmentsRequest::UploadChunk {
            node_id,
            sha256,
            size_bytes,
            index,
            total_chunks,
            bytes,
        } => {
            let chunk = Chunk {
                node_id,
                sha256,
                size_bytes: *size_bytes,
                index: *index,
                total_chunks: *total_chunks,
                bytes,
            };
            (node_id, sha256, upload(kernel, actor, &chunk).await?)
        }
        ChatAttachmentsRequest::ReadChunk {
            node_id,
            attachment_id,
            index,
        } => (
            node_id,
            attachment_id,
            read(kernel, actor, node_id, attachment_id, *index).await?,
        ),
    };
    let response = outcome.unwrap_or_else(|refusal| Response::Refused {
        node_id: node_id.clone(),
        attachment_id: attachment_id.clone(),
        refusal,
    });
    Ok(WorkspaceProtocolResponse::ChatAttachments(response))
}

struct Chunk<'a> {
    node_id: &'a str,
    sha256: &'a str,
    size_bytes: u64,
    index: u32,
    total_chunks: u32,
    bytes: &'a [u8],
}

async fn upload<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    chunk: &Chunk<'_>,
) -> Result<Outcome, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let gate = || authorize_node_channel(kernel, actor, chunk.node_id, CHANNEL_WRITE);
    if gate().await?.is_none() {
        return Ok(Err(Refusal::Denied));
    }
    let Some(max_bytes) = kernel.chat_attachment_max_bytes() else {
        return Ok(Err(Refusal::Unavailable));
    };
    if chunk.size_bytes > max_bytes {
        return Ok(Err(Refusal::TooLarge { max_bytes }));
    }
    let Chunk {
        sha256,
        size_bytes,
        index,
        total_chunks,
        ..
    } = *chunk;
    if let Err(refusal) =
        check_upload_chunk(sha256, size_bytes, index, total_chunks, chunk.bytes.len())
    {
        return Ok(Err(refusal));
    }
    let _guard = APPS_LOCK.lock().await;
    if gate().await?.is_none() {
        return Ok(Err(Refusal::Denied));
    }
    let slot = UploadSlot::ChatAttachment(actor);
    let whole = match backend
        .stage_upload_chunk(slot, sha256, index, total_chunks, chunk.bytes)
        .await?
    {
        Staged::Partial => return Ok(Ok(stored(chunk, false))),
        Staged::Mismatch => return Ok(Err(Refusal::Mismatch)),
        Staged::Complete { whole: Some(whole) } => whole,
        Staged::Complete { whole: None } => {
            let staging = backend.app_upload(slot).await?;
            match staging {
                Some(staging) => backend.assemble_app_upload(slot, &staging).await?,
                None => None,
            }
            .ok_or_else(|| NetworkError::msg("a complete chat upload lost a chunk"))?
        }
    };
    // Kept or refused, the slot is done with: a refused file is uploaded again from the start.
    let kept = keep(kernel, actor, chunk.node_id, sha256, &whole).await;
    backend.drop_app_upload(slot).await?;
    Ok(kept?.map(|()| stored(chunk, true)))
}

fn stored(chunk: &Chunk<'_>, stored: bool) -> Response {
    Response::ChunkStored {
        node_id: chunk.node_id.to_string(),
        attachment_id: chunk.sha256.to_string(),
        index: chunk.index,
        stored,
    }
}

/// With `APPS_LOCK` held: drops the node's stale uploads, then keeps `whole` as `id`, uploaded
/// by `actor`, within the node's file limit and the workspace's storage.
async fn keep<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    node_id: &str,
    id: &str,
    whole: &[u8],
) -> Result<Result<(), Refusal>, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let now_ms = crate::platform::SystemTime::now()
        .duration_since(crate::platform::UNIX_EPOCH)
        .map_err(|e| NetworkError::msg(format!("the clock is before 1970: {e}")))?
        .as_millis() as u64;
    let mut index = backend.chat_attachment_index(node_id).await?;
    let stale = index.stale(now_ms);
    if !stale.is_empty() {
        backend.drop_chat_attachments(node_id, &stale).await?;
        for (stale_id, _) in &stale {
            index.files.remove(stale_id);
        }
        backend.save_chat_attachment_index(node_id, &index).await?;
    }
    if let Err(refusal) = index.record_upload(id, whole.len() as u64, actor, now_ms) {
        return Ok(Err(refusal));
    }
    let root = root_of(node_id);
    let current = backend.app_ledger(&root).await?.total_bytes();
    let next = current.saturating_add(whole.len() as u64);
    match storage_admission(kernel, &root, current, next).await? {
        StorageAdmission::Fits => {}
        StorageAdmission::Over(_) => return Ok(Err(Refusal::StorageFull)),
        StorageAdmission::Unknown => return Ok(Err(Refusal::Unavailable)),
    }
    backend.store_chat_attachment(node_id, id, whole).await?;
    backend.save_chat_attachment_index(node_id, &index).await?;
    Ok(Ok(()))
}

async fn read<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    node_id: &str,
    attachment_id: &str,
    index: u32,
) -> Result<Outcome, NetworkError> {
    if !is_attachment_id(attachment_id)
        || authorize_node_channel(kernel, actor, node_id, CHANNEL_READ)
            .await?
            .is_none()
    {
        return Ok(Err(Refusal::Denied));
    }
    let backend = &kernel.domain_operations.backend_tx_manager;
    let files = backend.chat_attachment_index(node_id).await?;
    let Some(entry) = files.readable_by(attachment_id, actor) else {
        return Ok(Err(Refusal::Denied));
    };
    let size_bytes = entry.size_bytes;
    Ok(
        match backend
            .blob_chunk(&root_of(node_id), attachment_id, index)
            .await?
        {
            Some((meta, bytes)) => Ok(Response::Chunk {
                node_id: node_id.to_string(),
                attachment_id: attachment_id.to_string(),
                index,
                total_chunks: meta.total_chunks,
                size_bytes,
                bytes,
            }),
            None => Err(Refusal::Denied),
        },
    )
}
