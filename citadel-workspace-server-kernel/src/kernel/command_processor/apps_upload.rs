//! `UploadArtifactChunk`: one member's one artifact in progress, kept until a publish or an
//! install takes it, and refused when its whole does not hash to its digest.

use super::apps::{finish, Answer, Caller, Step};
use super::apps_gather::holds_at;
use crate::kernel::apps::artifact::check_upload_chunk;
use crate::kernel::apps::records::UploadSlot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::kernel::transaction::upload_staging::Staged;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;

pub(super) async fn upload_chunk<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    sha256_hex: &str,
    index: u32,
    total_chunks: u32,
    bytes: &[u8],
) -> Answer {
    finish(upload_steps(kernel, caller, sha256_hex, index, total_chunks, bytes).await)
}

async fn upload_steps<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    sha256_hex: &str,
    index: u32,
    total_chunks: u32,
    bytes: &[u8],
) -> Step<AppsResponse> {
    let mut may_upload = false;
    for permission in [
        Permission::AppPublish,
        Permission::AppInstallScoped,
        Permission::AppInstall,
    ] {
        may_upload =
            may_upload || holds_at(kernel, caller.user, WORKSPACE_ROOT_ID, permission).await?;
    }
    if !may_upload {
        return Err(AppsRefusal::PermissionRequired(Permission::AppInstall).into());
    }
    check_upload_chunk(sha256_hex, index, total_chunks, bytes.len())?;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    let slot = UploadSlot::Artifact(caller.user);
    let staged = backend
        .stage_upload_chunk(slot, sha256_hex, index, total_chunks, bytes)
        .await?;
    if staged == Staged::Mismatch {
        return Err(AppsRefusal::ArtifactMismatch.into());
    }
    Ok(AppsResponse::ArtifactChunkStored {
        sha256: sha256_hex.to_string(),
        index,
    })
}
