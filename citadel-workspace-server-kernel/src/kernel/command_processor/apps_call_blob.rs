//! `storage.blob` (R4.5): content-addressed blobs per app and scope, after `apps_call`
//! re-checked the capability. Writes are decided and made under `APPS_LOCK`, against the install
//! as it is (`apps_call_storage_write::recheck`). A put counts toward the tenant's storage and is
//! entered in its root's ledger before any chunk is written; a delete takes `EditContent` on the
//! install's node, and removes the chunks the ledger's length names whether or not the blob's
//! meta ever landed, so a write or delete that failed part-way leaves nothing unnamed.

use super::apps::Step;
use super::apps_call::reply_ok;
use super::apps_call_storage::{refused, root_of, unavailable};
use super::apps_call_storage_write::{entitled, recheck, Write};
use crate::kernel::apps::artifact::is_sha256_hex;
use crate::kernel::apps::storage::StorageRoot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use citadel_app_sdk_types::calls::{BlobRef, BytesValue};
use citadel_app_signature::sha256;
use citadel_sdk::prelude::Ratchet;

pub(super) async fn blob_get<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    root: &StorageRoot,
    digest: &str,
) -> Step<Vec<u8>> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let held = is_sha256_hex(digest) && backend.app_ledger(root).await?.blobs.contains_key(digest);
    let bytes = if held {
        backend.blob(root, digest).await?
    } else {
        None
    };
    Ok(match bytes {
        Some(bytes) => reply_ok(BytesValue {
            bytes: bytes.into(),
        }),
        None => unavailable("not_found"),
    })
}

pub(super) async fn blob_put<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    write: &Write<'_>,
    bytes: &[u8],
) -> Step<Vec<u8>> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let digest = hex::encode(sha256(bytes));
    let _guard = APPS_LOCK.lock().await;
    let install = match recheck(kernel, write).await? {
        Ok(install) => install,
        Err(refusal) => return Ok(refusal),
    };
    let root = root_of(&install)?;
    let mut ledger = backend.app_ledger(&root).await?;
    let listed = ledger.blobs.contains_key(&digest);
    if listed && backend.blob_complete(&root, &digest).await? {
        return Ok(reply_ok(BlobRef { sha256: digest }));
    }
    if let Err(why) = ledger.admits_blob(&digest, bytes.len() as u64) {
        return Ok(refused(why));
    }
    if !listed {
        let current = ledger.total_bytes();
        let next = current.saturating_add(bytes.len() as u64);
        if let Some(refusal) = entitled(kernel, &root, current, next).await? {
            return Ok(refusal);
        }
        ledger.blobs.insert(digest.clone(), bytes.len() as u64);
        backend.save_app_ledger(&root, &ledger).await?;
    }
    backend.store_blob(&root, &digest, bytes).await?;
    Ok(reply_ok(BlobRef { sha256: digest }))
}

pub(super) async fn blob_delete<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    write: &Write<'_>,
    digest: &str,
) -> Step<Vec<u8>> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    let install = match recheck(kernel, write).await? {
        Ok(install) => install,
        Err(refusal) => return Ok(refusal),
    };
    let root = root_of(&install)?;
    let mut ledger = backend.app_ledger(&root).await?;
    if let Some(len) = ledger.blobs.get(digest).copied() {
        backend.delete_blob(&root, digest, len).await?;
        ledger.blobs.remove(digest);
        backend.save_app_ledger(&root, &ledger).await?;
    }
    Ok(reply_ok(()))
}
