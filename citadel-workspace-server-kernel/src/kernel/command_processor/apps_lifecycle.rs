//! Ending or reverting an install: `Uninstall` (its installer or `AppManage`) and `Rollback`
//! (`AppManage`). `Update` and `Consent` are `apps_update`.

use super::apps::{audit_entry, finish, Answer, Caller, Halt, Step};
use super::apps_header::rewrite_mdx;
use super::apps_ihttp_end::end_install_relay;
use super::apps_member::visible_install;
use crate::kernel::apps::install::grant_details;
use crate::kernel::apps::md_header::remove;
use crate::kernel::apps::storage::StorageRoot;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use citadel_logging::warn;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, InstallState};
use citadel_workspace_types::apps_manifest::AppManifest;
use citadel_workspace_types::apps_responses::{AppsAuditEvent, AppsResponse};
use citadel_workspace_types::structs::Permission;
use std::collections::BTreeSet;

/// The install, if the caller made it or holds `AppManage` (`manager_only`: `AppManage` only).
pub(super) async fn authorised<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    manager_only: bool,
) -> Step<AppInstall> {
    let (install, manager) = visible_install(kernel, caller, install_id).await?;
    if manager || (!manager_only && install.installed_by == caller.user) {
        Ok(install)
    } else {
        Err(AppsRefusal::PermissionRequired(Permission::AppManage).into())
    }
}

/// The install as it is now, under the lock: it may have gone since it was authorised.
pub(super) async fn reread<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install_id: &str,
) -> Step<AppInstall> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    Ok(backend
        .app_install(install_id)
        .await?
        .ok_or(AppsRefusal::Unavailable)?)
}

pub(super) async fn uninstall<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    purge_storage: bool,
) -> Answer {
    let step = async {
        authorised(kernel, caller, install_id, false).await?;
        let backend = &kernel.domain_operations.backend_tx_manager;
        let _guard = APPS_LOCK.lock().await;
        let install = reread(kernel, install_id).await?;
        let mut log = Vec::new();
        for node_id in &install.injected_header_into {
            let app = install.app_id.clone();
            match rewrite_mdx(kernel, caller, node_id, |c| remove(c, &app)).await {
                Ok(true) => log.push(audit_entry(
                    caller.now,
                    caller.user,
                    &install.app_id,
                    Some(&install.id),
                    AppsAuditEvent::HeaderRemoved {
                        node_id: node_id.clone(),
                    },
                )),
                Ok(false) => {}
                Err(Halt::Failed(e)) => return Err(Halt::Failed(e)),
                // An admin rewrote the header since; it is theirs now, and stays.
                Err(Halt::Refused(why)) => {
                    warn!(target: "citadel", "The apps header of {node_id} was left as it is: {why:?}")
                }
            }
        }
        let pending = backend.app_pending(&install.id).await?;
        backend.remove_app_install(&install).await?;
        end_install_relay(kernel, &install.id);
        let mut manifests = vec![install.manifest_sha256.clone()];
        let mut artifacts = vec![install.artifact_sha256.clone()];
        for release in install.previous.iter() {
            manifests.push(release.manifest_sha256.clone());
            artifacts.push(release.artifact_sha256.clone());
        }
        for pending in pending.iter() {
            manifests.push(pending.release.manifest_sha256.clone());
            artifacts.push(pending.release.artifact_sha256.clone());
        }
        backend.sweep_apps_releases(&manifests, &artifacts).await?;
        if purge_storage {
            let scope_key = install.scope.scope_key().ok_or(AppsRefusal::Unavailable)?;
            let root = StorageRoot {
                app_id: install.app_id.clone(),
                scope_key,
            };
            backend.purge_app_storage(&root).await?;
        }
        let event = AppsAuditEvent::Uninstalled {
            purged_storage: purge_storage,
        };
        log.push(audit_entry(
            caller.now,
            caller.user,
            &install.app_id,
            Some(&install.id),
            event,
        ));
        backend.push_apps_audit(log).await?;
        Ok::<_, Halt>(AppsResponse::Uninstalled {
            install_id: install.id,
        })
    };
    finish(step.await)
}

/// The grant `granted` narrowed to what `manifest` asks.
pub(super) fn narrowed(
    granted: &BTreeSet<Capability>,
    manifest: &AppManifest,
) -> BTreeSet<Capability> {
    let asked: BTreeSet<Capability> = manifest.capabilities.iter().map(|r| r.cap).collect();
    granted.intersection(&asked).copied().collect()
}

pub(super) async fn rollback<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
) -> Answer {
    let step = async {
        authorised(kernel, caller, install_id, true).await?;
        let backend = &kernel.domain_operations.backend_tx_manager;
        let _guard = APPS_LOCK.lock().await;
        let mut install = reread(kernel, install_id).await?;
        let previous = install.previous.clone().ok_or(AppsRefusal::Unavailable)?;
        let release = backend
            .app_release(&previous.manifest_sha256)
            .await?
            .ok_or(AppsRefusal::Unavailable)?;
        let manifest = AppManifest::from_bytes(release.manifest.as_bytes())
            .map_err(|why| AppsRefusal::InvalidManifest(why.to_string()))?;
        let pending = backend.app_pending(&install.id).await?;
        let dropped = (
            install.manifest_sha256.clone(),
            install.artifact_sha256.clone(),
        );
        install.version = previous.version.clone();
        install.manifest_sha256 = previous.manifest_sha256;
        install.artifact_sha256 = previous.artifact_sha256;
        install.pinned_publisher_key = manifest.publisher.mldsa65_public_key.clone();
        install.granted = narrowed(&install.granted, &manifest);
        install.details = grant_details(&manifest, &install.granted);
        install.state = InstallState::Active;
        install.previous = None;
        backend.save_app_install(&install).await?;
        end_install_relay(kernel, &install.id);
        backend.save_app_pending(&install.id, None).await?;
        let (mut manifests, mut artifacts) = (vec![dropped.0], vec![dropped.1]);
        for pending in pending.iter() {
            manifests.push(pending.release.manifest_sha256.clone());
            artifacts.push(pending.release.artifact_sha256.clone());
        }
        backend.sweep_apps_releases(&manifests, &artifacts).await?;
        let event = AppsAuditEvent::RolledBack {
            to: install.version.clone(),
        };
        let entry = audit_entry(
            caller.now,
            caller.user,
            &install.app_id,
            Some(&install.id),
            event,
        );
        backend.push_apps_audit([entry]).await?;
        Ok::<_, Halt>(AppsResponse::RolledBack { install })
    };
    finish(step.await)
}
