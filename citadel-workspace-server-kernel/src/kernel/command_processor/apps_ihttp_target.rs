//! Which install an internal-HTTP request is for, and whether its caller may reach it.

use super::apps::Step;
use super::apps_gather::gather;
use crate::kernel::apps::audience::{audience_admits, scope_reaches};
use crate::kernel::apps::facts::ViewsNeeded;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, InstallState};
use citadel_workspace_types::apps_manifest::AppManifest;

/// The Active install of `app_id` at `scope_key` (there is at most one), or `NoHost`.
pub(super) async fn serving_install<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    app_id: &str,
    scope_key: &str,
) -> Step<AppInstall> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    for id in backend.app_install_ids_at(scope_key).await? {
        if let Some(install) = backend.app_install(&id).await? {
            if install.app_id == app_id && install.state == InstallState::Active {
                return Ok(install);
            }
        }
    }
    Err(AppsRefusal::NoHost.into())
}

/// Whether `user` is inside `install`'s audience and scope.
pub(super) async fn reaches<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install: &AppInstall,
    user: &str,
) -> Step<bool> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let Some(release) = backend.app_release(&install.manifest_sha256).await? else {
        return Ok(false);
    };
    let Ok(manifest) = AppManifest::from_bytes(release.manifest.as_bytes()) else {
        return Ok(false);
    };
    let mut needed = ViewsNeeded::default();
    needed.audience(&manifest.audience).scope(&install.scope);
    let facts = gather(kernel, &[user.to_string()], &needed).await?;
    Ok(audience_admits(&manifest.audience, user, &facts)
        && scope_reaches(&install.scope, user, &facts))
}
