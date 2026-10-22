//! What a member reads about the installs that concern them: the list, hiding one for
//! themselves, an install's signed release and its artifact, and (for `AppManage`) the audit
//! log. An install is visible to whoever it reaches, whoever made it, and any `AppManage`
//! holder; to anyone else it does not exist.

use super::apps::{finish, Answer, Caller, Halt, Step};
use super::apps_gather::{gather, holds_at};
use super::apps_offer::listing_of;
use crate::kernel::apps::audience::scope_reaches;
use crate::kernel::apps::facts::{GatheredFacts, ViewsNeeded};
use crate::kernel::apps::records::{StoredRelease, AUDIT_PAGE};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;

pub(super) async fn is_manager<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
) -> Result<bool, NetworkError> {
    holds_at(
        kernel,
        caller.user,
        WORKSPACE_ROOT_ID,
        Permission::AppManage,
    )
    .await
}

/// What the caller's views say about whether these installs reach them.
async fn facts_for<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    installs: &[AppInstall],
) -> Result<GatheredFacts, NetworkError> {
    let mut needed = ViewsNeeded::default();
    for install in installs {
        needed.scope(&install.scope);
    }
    gather(kernel, &[caller.user.to_string()], &needed).await
}

fn concerns(install: &AppInstall, caller: &Caller<'_>, facts: &GatheredFacts) -> bool {
    install.installed_by == caller.user || scope_reaches(&install.scope, caller.user, facts)
}

/// The install `id` if the caller may see it, with whether they hold `AppManage`.
pub(super) async fn visible_install<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    id: &str,
) -> Step<(AppInstall, bool)> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let manager = is_manager(kernel, caller).await?;
    let Some(install) = backend.app_install(id).await? else {
        return Err(AppsRefusal::Unavailable.into());
    };
    let facts = facts_for(kernel, caller, std::slice::from_ref(&install)).await?;
    if manager || concerns(&install, caller, &facts) {
        Ok((install, manager))
    } else {
        Err(AppsRefusal::Unavailable.into())
    }
}

pub(super) async fn list_installs<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
) -> Answer {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let manager = is_manager(kernel, caller).await?;
    let all = backend.all_app_installs().await?;
    let facts = facts_for(kernel, caller, &all).await?;
    let installs: Vec<AppInstall> = all
        .into_iter()
        .filter(|install| manager || concerns(install, caller, &facts))
        .collect();
    let hidden = backend.user_apps(caller.user).await?.disabled;
    let disabled_for_me = installs
        .iter()
        .filter(|install| hidden.contains(&install.id))
        .map(|install| install.id.clone())
        .collect();
    finish(Ok(AppsResponse::Installs {
        installs,
        disabled_for_me,
    }))
}

pub(super) async fn set_disabled<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    disabled: bool,
) -> Answer {
    let step = async {
        let backend = &kernel.domain_operations.backend_tx_manager;
        let (install, _) = visible_install(kernel, caller, install_id).await?;
        let facts = facts_for(kernel, caller, std::slice::from_ref(&install)).await?;
        if !scope_reaches(&install.scope, caller.user, &facts) {
            return Err(AppsRefusal::Unavailable.into());
        }
        let _guard = APPS_LOCK.lock().await;
        let mut apps = backend.user_apps(caller.user).await?;
        if disabled {
            apps.disabled.insert(install.id.clone());
        } else {
            apps.disabled.remove(&install.id);
        }
        backend.save_user_apps(caller.user, &apps).await?;
        Ok::<_, Halt>(AppsResponse::DisabledForMe {
            install_id: install.id,
            disabled,
        })
    };
    finish(step.await)
}

pub(super) async fn get_release<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
) -> Answer {
    let step = async {
        let backend = &kernel.domain_operations.backend_tx_manager;
        let (install, _) = visible_install(kernel, caller, install_id).await?;
        let release = |found: Option<StoredRelease>| found.ok_or(AppsRefusal::Unavailable);
        let current = release(backend.app_release(&install.manifest_sha256).await?)?;
        let pending = match backend.app_pending(&install.id).await? {
            Some(pending) => Some(release(
                backend
                    .app_release(&pending.release.manifest_sha256)
                    .await?,
            )?),
            None => None,
        };
        Ok::<_, Halt>(AppsResponse::Release {
            install_id: install.id.clone(),
            current: listing_of(&current, install.source.clone()),
            waiting_on: pending.map(|p| listing_of(&p, install.source.clone())),
        })
    };
    finish(step.await)
}

/// A chunk of an artifact one of the caller's visible installs runs, ran or waits on.
pub(super) async fn fetch_artifact<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    sha256: &str,
    index: u32,
) -> Answer {
    let step = async {
        let backend = &kernel.domain_operations.backend_tx_manager;
        let manager = is_manager(kernel, caller).await?;
        let all = backend.all_app_installs().await?;
        let facts = facts_for(kernel, caller, &all).await?;
        let mut named = false;
        for install in all
            .iter()
            .filter(|i| manager || concerns(i, caller, &facts))
        {
            let pending = backend.app_pending(&install.id).await?;
            named = named
                || install.artifact_sha256 == sha256
                || install
                    .previous
                    .as_ref()
                    .is_some_and(|p| p.artifact_sha256 == sha256)
                || pending.is_some_and(|p| p.release.artifact_sha256 == sha256);
        }
        let meta = backend.artifact_meta(sha256).await?;
        let (Some(meta), true) = (meta, named) else {
            return Err(AppsRefusal::Unavailable.into());
        };
        let Some(bytes) = backend.artifact_chunk(sha256, index).await? else {
            return Err(AppsRefusal::Unavailable.into());
        };
        Ok::<_, Halt>(AppsResponse::ArtifactChunk {
            sha256: sha256.to_string(),
            index,
            total_chunks: meta.total_chunks,
            bytes,
        })
    };
    finish(step.await)
}

pub(super) async fn list_audit<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    before_ms: Option<u64>,
) -> Answer {
    let step = async {
        if !is_manager(kernel, caller).await? {
            return Err(AppsRefusal::PermissionRequired(Permission::AppManage).into());
        }
        let backend = &kernel.domain_operations.backend_tx_manager;
        let entries = backend
            .apps_audit()
            .await?
            .into_iter()
            .rev()
            .filter(|entry| before_ms.is_none_or(|before| entry.at_ms < before))
            .take(AUDIT_PAGE)
            .collect();
        Ok::<_, Halt>(AppsResponse::Audit { entries })
    };
    finish(step.await)
}
