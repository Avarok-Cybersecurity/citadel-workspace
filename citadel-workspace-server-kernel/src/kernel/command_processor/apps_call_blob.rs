//! `storage.blob` (R4.5): content-addressed blobs per app and scope, after `apps_call`
//! re-checked the capability. Writes are made under `APPS_LOCK`, against the install as it is.

use super::apps::Step;
use super::apps_call::reply_ok;
use super::apps_call_storage::{refused, unavailable};
use super::apps_lifecycle::reread;
use crate::kernel::apps::artifact::is_sha256_hex;
use crate::kernel::apps::storage::StorageRoot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use citadel_app_sdk_types::calls::{BlobRef, BytesValue};
use citadel_app_signature::sha256;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps_install::AppInstall;

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
    install: &AppInstall,
    root: &StorageRoot,
    bytes: &[u8],
) -> Step<Vec<u8>> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let digest = hex::encode(sha256(bytes));
    let _guard = APPS_LOCK.lock().await;
    reread(kernel, &install.id).await?;
    let mut ledger = backend.app_ledger(root).await?;
    if let Err(why) = ledger.admits_blob(&digest, bytes.len() as u64) {
        return Ok(refused(why));
    }
    if !ledger.blobs.contains_key(&digest) {
        backend.store_blob(root, &digest, bytes).await?;
        ledger.blobs.insert(digest.clone(), bytes.len() as u64);
        backend.save_app_ledger(root, &ledger).await?;
    }
    Ok(reply_ok(BlobRef { sha256: digest }))
}

pub(super) async fn blob_delete<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install: &AppInstall,
    root: &StorageRoot,
    digest: &str,
) -> Step<Vec<u8>> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    reread(kernel, &install.id).await?;
    let mut ledger = backend.app_ledger(root).await?;
    if ledger.blobs.remove(digest).is_some() {
        backend.delete_blob(root, digest).await?;
        backend.save_app_ledger(root, &ledger).await?;
    }
    Ok(reply_ok(()))
}
