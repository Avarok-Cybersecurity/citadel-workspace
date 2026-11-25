//! `DocumentPictures`: storing a picture of a page's or a chat document's document and reading one
//! back (`citadel_workspace_types::document_pictures`, `kernel::document_pictures`).
//!
//! Every request asks the document's gate first (`admit`): a page's is the node's `EditMdx` or
//! `ViewContent` on a node that exists, a chat document's the channel's send or read permission
//! (`authorize_node_channel`). Every way of failing it is `Denied`.
//!
//! An upload is staged chunk by chunk in the member's one picture slot, its size reserved toward
//! the workspace's storage from its first chunk (`upload_reservation`); the chunk that completes it
//! is checked against its id, admitted against the document's picture cap and the workspace's
//! storage, and stored. All of that is under `APPS_LOCK`, which a node delete holds across its
//! purge, so the gate is asked again once the lock is held: a picture is never stored for a
//! document already deleted. A stored picture is readable at once by anyone the read gate admits.

use super::apps_call_storage_write::{storage_admission, StorageAdmission};
use super::apps_gather::node_exists;
use super::upload_reservation::reserve_upload;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::apps::records::UploadSlot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::document_pictures::{address_of, root_of, staging_root, DocumentPictureLimits};
use crate::kernel::documents::address::DocAddress;
use crate::kernel::group_access::authorize_node_channel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::kernel::transaction::upload_staging::Staged;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::document_pictures::{
    check_picture_chunk, picture_digest, required_permission, DocumentPictureRefusal as Refusal,
    DocumentPicturesRequest as Request, DocumentPicturesResponse as Response,
};
use citadel_workspace_types::WorkspaceProtocolResponse;

type Outcome = Result<Response, Refusal>;

pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    request: &Request,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let outcome = match request {
        Request::UploadChunk { .. } => upload(kernel, actor, request).await?,
        Request::ReadChunk {
            content_id, index, ..
        } => read(kernel, actor, request, content_id, *index).await?,
        Request::Limits { .. } => limits(kernel, actor, request).await?,
    };
    let response = outcome.unwrap_or_else(|refusal| Response::Refused {
        doc: request.doc().clone(),
        content_id: request.content_id().map(str::to_string),
        refusal,
    });
    Ok(WorkspaceProtocolResponse::DocumentPictures(response))
}

/// The document `request` is about, when `actor` passes its gate for it; `None` is `Denied`.
async fn admit<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    request: &Request,
) -> Result<Option<DocAddress>, NetworkError> {
    let Some(doc) = address_of(request.doc()) else {
        return Ok(None);
    };
    let permission = required_permission(request);
    let admitted = match &doc.chat_doc {
        None => {
            node_exists(kernel, &doc.node_id).await?
                && kernel
                    .domain_operations
                    .check_entity_permission(actor, &doc.node_id, permission)
                    .await?
        }
        Some(_) => authorize_node_channel(kernel, actor, &doc.node_id, permission)
            .await?
            .is_some(),
    };
    Ok(admitted.then_some(doc))
}

fn admitted(admission: StorageAdmission) -> Result<(), Refusal> {
    match admission {
        StorageAdmission::Fits => Ok(()),
        StorageAdmission::Over(_) => Err(Refusal::StorageFull),
        StorageAdmission::Unknown => Err(Refusal::Unavailable),
    }
}

async fn upload<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    request: &Request,
) -> Result<Outcome, NetworkError> {
    let Request::UploadChunk {
        content_id,
        size_bytes,
        index,
        total_chunks,
        bytes,
        ..
    } = request
    else {
        return Err(NetworkError::msg("an upload was dispatched as a read"));
    };
    let (size_bytes, index, total_chunks) = (*size_bytes, *index, *total_chunks);
    if admit(kernel, actor, request).await?.is_none() {
        return Ok(Err(Refusal::Denied));
    }
    let Some(limits) = kernel
        .chat_attachment_limits()
        .map(DocumentPictureLimits::of_chat_attachments)
    else {
        return Ok(Err(Refusal::Unavailable));
    };
    if size_bytes > limits.max_bytes {
        return Ok(Err(Refusal::TooLarge {
            max_bytes: limits.max_bytes,
        }));
    }
    if let Err(refusal) =
        check_picture_chunk(content_id, size_bytes, index, total_chunks, bytes.len())
    {
        return Ok(Err(refusal));
    }
    let digest = picture_digest(content_id)
        .ok_or_else(|| NetworkError::msg("a checked content id has no digest"))?;
    let _guard = APPS_LOCK.lock().await;
    let Some(doc) = admit(kernel, actor, request).await? else {
        return Ok(Err(Refusal::Denied));
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let (slot, staging) = (UploadSlot::DocumentPicture(actor), staging_root());
    let reserved = reserve_upload(
        kernel,
        slot,
        &staging,
        actor,
        digest,
        total_chunks,
        size_bytes,
    )
    .await?;
    if let Err(refusal) = admitted(reserved) {
        return Ok(Err(refusal));
    }
    let whole = match backend
        .stage_upload_chunk(slot, digest, index, total_chunks, bytes)
        .await?
    {
        Staged::Partial => return Ok(Ok(stored(request, content_id, index, false))),
        Staged::Mismatch => {
            backend.reserve_staging(&staging, actor, None).await?;
            return Ok(Err(Refusal::Mismatch));
        }
        Staged::Complete { whole: Some(whole) } => whole,
        Staged::Complete { whole: None } => backend.completed_upload(slot).await?,
    };
    // Kept or refused, the slot is done with; its reservation goes first, so the picture is not
    // counted twice when `keep` admits it.
    backend.reserve_staging(&staging, actor, None).await?;
    let kept = keep(kernel, &doc, digest, &whole, limits).await;
    backend.drop_app_upload(slot).await?;
    Ok(kept?.map(|()| stored(request, content_id, index, true)))
}

/// Keeps `whole` as `digest` among `doc`'s pictures, within the document's cap and the
/// workspace's storage. A picture the document already holds is kept as it is.
async fn keep<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    doc: &DocAddress,
    digest: &str,
    whole: &[u8],
    limits: DocumentPictureLimits,
) -> Result<Result<(), Refusal>, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let root = root_of(doc);
    let ledger = backend.app_ledger(&root).await?;
    if ledger.blobs.contains_key(digest) && backend.blob_complete(&root, digest).await? {
        return Ok(Ok(()));
    }
    let max_pictures = limits.max_pictures_per_document;
    if !ledger.blobs.contains_key(digest) && ledger.blobs.len() >= max_pictures as usize {
        return Ok(Err(Refusal::DocumentFull { max_pictures }));
    }
    let current = ledger.total_bytes();
    let next = current.saturating_add(whole.len() as u64);
    if let Err(refusal) = admitted(storage_admission(kernel, &root, current, next).await?) {
        return Ok(Err(refusal));
    }
    backend.store_document_picture(doc, digest, whole).await?;
    Ok(Ok(()))
}

/// What a member who may add pictures to the document may add: the limits `upload` enforces.
async fn limits<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    request: &Request,
) -> Result<Outcome, NetworkError> {
    if admit(kernel, actor, request).await?.is_none() {
        return Ok(Err(Refusal::Denied));
    }
    Ok(
        match kernel
            .chat_attachment_limits()
            .map(DocumentPictureLimits::of_chat_attachments)
        {
            Some(limits) => Ok(Response::Limits {
                doc: request.doc().clone(),
                max_bytes: limits.max_bytes,
                max_pictures: limits.max_pictures_per_document,
            }),
            None => Err(Refusal::Unavailable),
        },
    )
}

fn stored(request: &Request, content_id: &str, index: u32, stored: bool) -> Response {
    Response::ChunkStored {
        doc: request.doc().clone(),
        content_id: content_id.to_string(),
        index,
        stored,
    }
}

async fn read<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    request: &Request,
    content_id: &str,
    index: u32,
) -> Result<Outcome, NetworkError> {
    let Some(doc) = admit(kernel, actor, request).await? else {
        return Ok(Err(Refusal::Denied));
    };
    let Some(digest) = picture_digest(content_id) else {
        return Ok(Err(Refusal::BadChunk));
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    Ok(
        match backend.blob_chunk(&root_of(&doc), digest, index).await? {
            Some((meta, bytes)) => Ok(Response::Chunk {
                doc: request.doc().clone(),
                content_id: content_id.to_string(),
                index,
                total_chunks: meta.total_chunks,
                size_bytes: u64::from(meta.bytes),
                bytes,
            }),
            None => Err(Refusal::NotFound),
        },
    )
}
