//! `Update` and `Consent`. An update that asks for nothing new is taken; one that does, or is
//! signed by another key, waits for consent while the installed version keeps running.

use super::apps::{audit_entry, finish, Answer, Caller, Halt, Step};
use super::apps_gather::{gather, snapshot};
use super::apps_ihttp_end::end_install_relay;
use super::apps_install::people;
use super::apps_lifecycle::{authorised, reread};
use super::apps_offer::{commit_artifact, obtain_artifact, resolve_offer};
use crate::kernel::apps::audience::scope_reach_within_audience;
use crate::kernel::apps::facts::{authority_node, ViewsNeeded};
use crate::kernel::apps::install::{grant_details, is_first_party, verify_listing};
use crate::kernel::apps::records::{PendingRelease, ReleaseRef};
use crate::kernel::apps::rules::check_grant;
use crate::kernel::apps::update::{decide_update, require_newer, UpdateOutcome};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{
    AppInstall, AppsRefusal, InstallState, ListingSource, PreviousRelease,
};
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer};
use citadel_workspace_types::apps_responses::{AppsAuditEvent, AppsResponse};
use std::collections::BTreeSet;

/// An install takes updates from where it came from: its registry entry, or signed manifests.
fn offer_matches(install: &AppInstall, offer: &ListingOffer) -> bool {
    match (offer, &install.source) {
        (
            ListingOffer::Registry { entry_id },
            ListingSource::WorkspaceRegistry { entry_id: had },
        ) => entry_id == had,
        (ListingOffer::Registry { .. }, _) => false,
        (ListingOffer::Signed { .. }, source) => {
            !matches!(source, ListingSource::WorkspaceRegistry { .. })
        }
    }
}

/// `install` now running `next`, the release it ran kept for a rollback.
fn advance(install: &mut AppInstall, next: &ReleaseRef) -> Option<PreviousRelease> {
    let replaced = install.previous.take();
    install.previous = Some(PreviousRelease {
        version: install.version.clone(),
        manifest_sha256: install.manifest_sha256.clone(),
        artifact_sha256: install.artifact_sha256.clone(),
    });
    install.version = next.version.clone();
    install.manifest_sha256 = next.manifest_sha256.clone();
    install.artifact_sha256 = next.artifact_sha256.clone();
    install.state = InstallState::Active;
    replaced
}

pub(super) async fn update<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    listing: &ListingOffer,
) -> Answer {
    let step = update_steps(kernel, caller, install_id, listing).await;
    if let Ok(AppsResponse::Updated { install }) = &step {
        // Active: the new release runs now (an update waiting on consent keeps the old one).
        if matches!(install.state, InstallState::Active) {
            end_install_relay(kernel, &install.id, caller.now);
        }
    }
    finish(step)
}

async fn update_steps<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    listing: &ListingOffer,
) -> Step<AppsResponse> {
    let install = authorised(kernel, caller, install_id, false).await?;
    if !offer_matches(&install, listing) {
        return Err(AppsRefusal::Unavailable.into());
    }
    let offered = resolve_offer(kernel, caller, listing).await?;
    if offered.manifest_sha256 == install.manifest_sha256 {
        return Ok(AppsResponse::UpToDate {
            install_id: install.id,
        });
    }
    let manifest = &offered.manifest;
    require_newer(&install, manifest)?;
    if !manifest.scopes.contains(&install.scope.kind()) {
        return Err(AppsRefusal::ScopeNotSupported.into());
    }
    let mut needed = ViewsNeeded::default();
    needed.audience(&manifest.audience).scope(&install.scope);
    let facts = gather(kernel, &people(kernel, &install.scope).await?, &needed).await?;
    scope_reach_within_audience(&install.scope, &manifest.audience, &facts.members, &facts)?;
    let artifact = obtain_artifact(kernel, caller, &manifest.artifact).await?;

    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    let mut install = reread(kernel, install_id).await?;
    require_newer(&install, manifest)?;
    commit_artifact(kernel, caller, &manifest.artifact.sha256, artifact).await?;
    backend
        .save_app_release(&offered.manifest_sha256, &offered.release)
        .await?;
    let next = ReleaseRef {
        version: manifest.version.clone(),
        manifest_sha256: offered.manifest_sha256.clone(),
        artifact_sha256: manifest.artifact.sha256.clone(),
    };
    let stale = backend.app_pending(&install.id).await?;
    let mut sweep = stale.map(|p| p.release).into_iter().collect::<Vec<_>>();
    match decide_update(&install, manifest) {
        UpdateOutcome::Apply { granted, details } => {
            let from = install.version.clone();
            if let Some(replaced) = advance(&mut install, &next) {
                sweep.push(ReleaseRef {
                    version: replaced.version,
                    manifest_sha256: replaced.manifest_sha256,
                    artifact_sha256: replaced.artifact_sha256,
                });
            }
            install.granted = granted;
            install.details = details;
            backend.save_app_pending(&install.id, None).await?;
            let event = AppsAuditEvent::Updated {
                from,
                to: next.version.clone(),
            };
            let entry = audit_entry(
                caller.now,
                caller.user,
                &install.app_id,
                Some(&install.id),
                event,
            );
            backend.push_apps_audit([entry]).await?;
        }
        UpdateOutcome::NeedsConsent(reason) => {
            let pending = PendingRelease {
                release: next.clone(),
                publisher_key: manifest.publisher.mldsa65_public_key.clone(),
            };
            backend
                .save_app_pending(&install.id, Some(&pending))
                .await?;
            install.state = InstallState::NeedsConsent {
                version: next.version.clone(),
                reason,
            };
        }
    }
    backend.save_app_install(&install).await?;
    let manifests: Vec<String> = sweep.iter().map(|r| r.manifest_sha256.clone()).collect();
    let artifacts: Vec<String> = sweep.iter().map(|r| r.artifact_sha256.clone()).collect();
    backend.sweep_apps_releases(&manifests, &artifacts).await?;
    Ok(AppsResponse::Updated { install })
}

pub(super) async fn consent<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    request: &AppsRequest,
) -> Answer {
    let AppsRequest::Consent {
        install_id,
        version,
        granted,
        pinned_publisher_key,
    } = request
    else {
        return finish(Err(AppsRefusal::Unavailable.into()));
    };
    let granted: BTreeSet<Capability> = granted.iter().copied().collect();
    let step = async {
        let install = authorised(kernel, caller, install_id, false).await?;
        let backend = &kernel.domain_operations.backend_tx_manager;
        let pending = backend.app_pending(&install.id).await?;
        let waiting =
            matches!(&install.state, InstallState::NeedsConsent { version: v, .. } if v == version);
        let pending = pending
            .filter(|_| waiting)
            .ok_or(AppsRefusal::Unavailable)?;
        let release = backend
            .app_release(&pending.release.manifest_sha256)
            .await?
            .ok_or(AppsRefusal::Unavailable)?;
        let manifest = verify_listing(release.manifest.as_bytes(), &release.signature)?;
        if &pending.publisher_key != pinned_publisher_key {
            return Err(AppsRefusal::BadSignature.into());
        }
        let authority = authority_node(&install.scope, WORKSPACE_ROOT_ID);
        let first_party = is_first_party(&pending.publisher_key);
        for who in BTreeSet::from([install.installed_by.as_str(), caller.user]) {
            let held = snapshot(kernel, who, authority).await?;
            check_grant(
                &manifest.capabilities,
                &granted,
                &|p| held.holds(p),
                first_party,
            )?;
        }

        let _guard = APPS_LOCK.lock().await;
        let mut install = reread(kernel, install_id).await?;
        let still = backend.app_pending(&install.id).await?;
        if still.as_ref() != Some(&pending) {
            return Err(AppsRefusal::Unavailable.into());
        }
        let replaced = advance(&mut install, &pending.release);
        install.pinned_publisher_key = pending.publisher_key.clone();
        install.details = grant_details(&manifest, &granted);
        install.granted = granted.clone();
        backend.save_app_install(&install).await?;
        backend.save_app_pending(&install.id, None).await?;
        end_install_relay(kernel, &install.id, caller.now);
        if let Some(replaced) = replaced {
            backend
                .sweep_apps_releases(&[replaced.manifest_sha256], &[replaced.artifact_sha256])
                .await?;
        }
        let event = AppsAuditEvent::Consented {
            version: version.clone(),
        };
        let entry = audit_entry(
            caller.now,
            caller.user,
            &install.app_id,
            Some(&install.id),
            event,
        );
        backend.push_apps_audit([entry]).await?;
        Ok::<_, Halt>(AppsResponse::Consented { install })
    };
    finish(step.await)
}
