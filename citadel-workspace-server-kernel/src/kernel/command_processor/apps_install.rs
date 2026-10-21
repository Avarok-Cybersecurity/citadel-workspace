//! `Install`: verify the listing, decide with `kernel::apps::install`, then store the artifact,
//! the release, the install and, when asked, the document's requirement, under `APPS_LOCK`.

use super::apps::{audit_entry, finish, Answer, Caller, Step};
use super::apps_gather::{gather, members, node_exists, snapshot};
use super::apps_header::rewrite_mdx;
use super::apps_offer::{commit_artifact, obtain_artifact, resolve_offer};
use crate::kernel::apps::facts::{authority_node, ViewsNeeded};
use crate::kernel::apps::install::{decide_install, InstallInput};
use crate::kernel::apps::md_header::inject;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::InstallScope;
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, InstallState};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::{AppsAuditEvent, AppsResponse};

pub(super) async fn install<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    request: &AppsRequest,
) -> Answer {
    finish(install_steps(kernel, caller, request).await)
}

/// Everyone a decision about `scope` can ask about: the members, and anyone it names.
pub(super) async fn people<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    scope: &InstallScope,
) -> Step<Vec<String>> {
    let mut users = members(kernel).await?;
    match scope {
        InstallScope::Users(named) => users.extend(named.iter().cloned()),
        InstallScope::SelfOnly(user) => users.push(user.clone()),
        _ => {}
    }
    Ok(users)
}

async fn install_steps<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    request: &AppsRequest,
) -> Step<AppsResponse> {
    let AppsRequest::Install {
        app_id,
        version,
        listing,
        scope,
        granted,
        pinned_publisher_key,
        inject_requirement,
    } = request
    else {
        return Err(AppsRefusal::Unavailable.into());
    };
    let offered = resolve_offer(kernel, caller, listing).await?;
    let manifest = &offered.manifest;
    let authority = authority_node(scope, WORKSPACE_ROOT_ID);
    let at_root = snapshot(kernel, caller.user, WORKSPACE_ROOT_ID).await?;
    let at_authority = snapshot(kernel, caller.user, authority).await?;
    let mut needed = ViewsNeeded::default();
    needed.audience(&manifest.audience).scope(scope);
    let facts = gather(kernel, &people(kernel, scope).await?, &needed).await?;
    let plan = decide_install(&InstallInput {
        installer: caller.user,
        manifest,
        app_id,
        version,
        scope,
        granted,
        pinned_publisher_key,
        inject_requirement: *inject_requirement,
        at_root: &at_root,
        at_authority: &at_authority,
        scope_node_exists: node_exists(kernel, authority).await?,
        facts: &facts,
    })?;
    let artifact = obtain_artifact(kernel, caller, &manifest.artifact).await?;
    let scope_key = scope.scope_key().ok_or(AppsRefusal::ScopeNotSupported)?;

    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    for id in backend.app_install_ids_at(&scope_key).await? {
        if let Some(existing) = backend.app_install(&id).await? {
            if existing.app_id == manifest.id {
                return Err(AppsRefusal::AlreadyInstalled {
                    install_id: existing.id,
                }
                .into());
            }
        }
    }
    commit_artifact(kernel, caller, &manifest.artifact.sha256, artifact).await?;
    backend
        .save_app_release(&offered.manifest_sha256, &offered.release)
        .await?;
    let mut record = AppInstall {
        id: uuid::Uuid::new_v4().to_string(),
        app_id: manifest.id.clone(),
        version: manifest.version.clone(),
        manifest_sha256: offered.manifest_sha256.clone(),
        artifact_sha256: manifest.artifact.sha256.clone(),
        pinned_publisher_key: manifest.publisher.mldsa65_public_key.clone(),
        scope: scope.clone(),
        granted: plan.granted,
        details: plan.details,
        installed_by: caller.user.to_string(),
        installed_at_ms: caller.now,
        state: InstallState::Active,
        previous: None,
        injected_header_into: Vec::new(),
        source: offered.source.clone(),
    };
    let mut log = vec![audit_entry(
        caller.now,
        caller.user,
        &record.app_id,
        Some(&record.id),
        AppsAuditEvent::Installed {
            scope: scope.clone(),
        },
    )];
    if let Some(node_id) = &plan.inject_into {
        let (app, min) = (record.app_id.clone(), record.version.clone());
        let injected = rewrite_mdx(kernel, caller, node_id, |c| inject(c, &app, &min)).await;
        if injected.is_err() {
            let (manifest_sha, artifact_sha) = (&record.manifest_sha256, &record.artifact_sha256);
            backend
                .sweep_apps_releases(
                    std::slice::from_ref(manifest_sha),
                    std::slice::from_ref(artifact_sha),
                )
                .await?;
        }
        if injected? {
            record.injected_header_into.push(node_id.clone());
            let event = AppsAuditEvent::HeaderInjected {
                node_id: node_id.clone(),
            };
            log.push(audit_entry(
                caller.now,
                caller.user,
                &app,
                Some(&record.id),
                event,
            ));
        }
    }
    backend.save_app_install(&record).await?;
    backend.push_apps_audit(log).await?;
    Ok(AppsResponse::Installed { install: record })
}
