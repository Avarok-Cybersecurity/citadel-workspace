//! The workspace registry: listing it, reading one entry, publishing to it. Uploading an
//! artifact is `apps_upload`.

use super::apps::{audit_entry, finish, Answer, Caller, Step};
use super::apps_gather::holds_at;
use super::apps_offer::{admitted, commit_artifact, listing_of, obtain_artifact, resolve_offer};
use crate::kernel::apps::records::{RegistryEntry, ReleaseRef};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_app_id::AppVersion;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::AppAudience;
use citadel_workspace_types::apps_install::{AppsRefusal, ListingSource};
use citadel_workspace_types::apps_protocol::ListingOffer;
use citadel_workspace_types::apps_responses::{AppsAuditEvent, AppsResponse};
use citadel_workspace_types::structs::Permission;

/// Never an entry's id: the registry read and the release read a missing listing makes, so a
/// missing listing costs what a hidden one does.
const ABSENT: &str = "-";

pub(super) async fn list_catalogue<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
) -> Answer {
    finish(catalogue(kernel, caller).await)
}

async fn catalogue<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
) -> Step<AppsResponse> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut listings = Vec::new();
    for entry in backend.registry_entries().await? {
        if !admitted(kernel, caller, &entry).await? {
            continue;
        }
        if let Some(release) = backend.app_release(&entry.release.manifest_sha256).await? {
            let source = ListingSource::WorkspaceRegistry {
                entry_id: entry.entry_id.clone(),
            };
            listings.push(listing_of(&release, source));
        }
    }
    Ok(AppsResponse::Catalogue { listings })
}

/// `Unavailable` for a listing that is missing and one the caller may not see alike: the same
/// reads (an audience check, a release read) and the same answer.
pub(super) async fn get_listing<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    app_id: &str,
) -> Answer {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let entry = backend.registry_entry(app_id).await?;
    let probe = RegistryEntry {
        entry_id: ABSENT.to_string(),
        release: ReleaseRef {
            version: ABSENT.to_string(),
            manifest_sha256: ABSENT.to_string(),
            artifact_sha256: ABSENT.to_string(),
        },
        audience: AppAudience::Members { usernames: vec![] },
        published_by: ABSENT.to_string(),
        published_at_ms: 0,
    };
    let checked = entry.as_ref().unwrap_or(&probe);
    let visible = admitted(kernel, caller, checked).await?;
    let release = backend
        .app_release(&checked.release.manifest_sha256)
        .await?;
    finish(match (entry, visible, release) {
        (Some(entry), true, Some(release)) => Ok(AppsResponse::Listing {
            listing: listing_of(
                &release,
                ListingSource::WorkspaceRegistry {
                    entry_id: entry.entry_id,
                },
            ),
        }),
        _ => Err(AppsRefusal::Unavailable.into()),
    })
}

pub(super) async fn publish<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    manifest_bytes: &[u8],
    signature: &str,
) -> Answer {
    finish(publish_steps(kernel, caller, manifest_bytes, signature).await)
}

/// Refused unless strictly newer than the registry's entry for the same app.
fn newer_than(entry: Option<&RegistryEntry>, version: &str) -> Step<()> {
    let Some(entry) = entry else {
        return Ok(());
    };
    match (
        AppVersion::parse(&entry.release.version),
        AppVersion::parse(version),
    ) {
        (Ok(have), Ok(offered)) if offered > have => Ok(()),
        _ => Err(AppsRefusal::VersionNotNewer.into()),
    }
}

async fn publish_steps<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    manifest_bytes: &[u8],
    signature: &str,
) -> Step<AppsResponse> {
    if !holds_at(
        kernel,
        caller.user,
        WORKSPACE_ROOT_ID,
        Permission::AppPublish,
    )
    .await?
    {
        return Err(AppsRefusal::PermissionRequired(Permission::AppPublish).into());
    }
    let offer = ListingOffer::Signed {
        manifest_bytes: manifest_bytes.to_vec(),
        signature: signature.to_string(),
    };
    let offered = resolve_offer(kernel, caller, &offer).await?;
    let manifest = &offered.manifest;
    if manifest.audience == (AppAudience::Global {}) {
        return Err(AppsRefusal::InvalidManifest(
            "a workspace listing's audience cannot be global".to_string(),
        )
        .into());
    }
    let backend = &kernel.domain_operations.backend_tx_manager;
    newer_than(
        backend.registry_entry(&manifest.id).await?.as_ref(),
        &manifest.version,
    )?;
    let artifact = obtain_artifact(kernel, caller, &manifest.artifact).await?;

    let _guard = APPS_LOCK.lock().await;
    let before = backend.registry_entry(&manifest.id).await?;
    newer_than(before.as_ref(), &manifest.version)?;
    commit_artifact(kernel, caller, &manifest.artifact.sha256, artifact).await?;
    backend
        .save_app_release(&offered.manifest_sha256, &offered.release)
        .await?;
    let entry = RegistryEntry {
        entry_id: manifest.id.clone(),
        release: ReleaseRef {
            version: manifest.version.clone(),
            manifest_sha256: offered.manifest_sha256.clone(),
            artifact_sha256: manifest.artifact.sha256.clone(),
        },
        audience: manifest.audience.clone(),
        published_by: caller.user.to_string(),
        published_at_ms: caller.now,
    };
    backend.save_registry_entry(&entry).await?;
    if let Some(before) = before {
        let old = before.release;
        backend
            .sweep_apps_releases(&[old.manifest_sha256], &[old.artifact_sha256])
            .await?;
    }
    let event = AppsAuditEvent::Published {
        version: manifest.version.clone(),
    };
    backend
        .push_apps_audit([audit_entry(
            caller.now,
            caller.user,
            &manifest.id,
            None,
            event,
        )])
        .await?;
    Ok(AppsResponse::Published {
        entry_id: entry.entry_id,
    })
}
