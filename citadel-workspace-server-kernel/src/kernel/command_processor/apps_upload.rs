//! `UploadArtifactChunk`: one member's one artifact in progress, kept until a publish or an
//! install takes it, and refused when its whole does not hash to its digest.

use super::apps::{finish, Answer, Caller, Step};
use super::apps_gather::holds_at;
use crate::kernel::apps::artifact::check_upload_chunk;
use crate::kernel::apps::records::UploadStaging;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_app_signature::sha256;
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
    let mut staging = match backend.app_upload(caller.user).await? {
        Some(staging) if staging.sha256 == sha256_hex && staging.total_chunks == total_chunks => {
            staging
        }
        // One upload per member: a different artifact replaces the one in progress.
        _ => {
            backend.drop_app_upload(caller.user).await?;
            UploadStaging {
                sha256: sha256_hex.to_string(),
                total_chunks,
                received: Default::default(),
                complete: false,
            }
        }
    };
    if !staging.complete {
        backend
            .save_app_upload_chunk(caller.user, index, bytes)
            .await?;
        staging.received.insert(index);
        backend.save_app_upload(caller.user, &staging).await?;
    }
    if !staging.complete && staging.received.len() as u32 == total_chunks {
        let whole = backend.assemble_app_upload(caller.user, &staging).await?;
        if whole.is_none_or(|whole| hex::encode(sha256(&whole)) != sha256_hex) {
            backend.drop_app_upload(caller.user).await?;
            return Err(AppsRefusal::ArtifactMismatch.into());
        }
        staging.complete = true;
        backend.save_app_upload(caller.user, &staging).await?;
    }
    Ok(AppsResponse::ArtifactChunkStored {
        sha256: sha256_hex.to_string(),
        index,
    })
}
