//! Installing the first-party apps every workspace is provisioned with (Calendar design §3.2): each
//! glue release the server embeds (`apps::first_party_bundles`), once, as an Active install for
//! the whole workspace, with the release stored for it. Decided by `apps::first_party`, which also
//! lists an app-ABI release without installing it: its module is stored here (`store_artifact`,
//! once per sha256), so an admin's install finds it `Stored` (`apps_offer::obtain_artifact`) and
//! needs no upload or fetch.
//!
//! Run at every provisioning pass, so it is idempotent: an app installed for the workspace already
//! is left as it is, whatever its version (an update is an admin's, as for any install). A release
//! the decision refuses fails the pass: the deploy checked it, so a refusal here is a release that
//! should not run, not one to skip.
//!
//! Each release is also recorded (`FirstPartyReleases`), the newest the server was built with: it
//! is what the catalogue lists and an install takes after an admin uninstalled the app
//! (`apps_listing`, `apps_offer`). An app recorded already was provisioned once, so it is never
//! installed again here: an uninstall is the admin's, and a restart does not undo it. A workspace
//! provisioned before the record existed has none; its audit log says whether provisioning
//! installed the app before (the log is bounded, so a long-busy workspace may get it once more).

use super::apps::audit_entry;
use crate::kernel::apps::first_party::{plan_provisioning, Provisioning, SignedBundle};
use crate::kernel::apps::records::StoredRelease;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::platform::{SystemTime, UNIX_EPOCH};
use citadel_app_signature::sha256;
use citadel_logging::info;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps::InstallScope;
use citadel_workspace_types::apps_install::{AppInstall, InstallState, ListingSource};
use citadel_workspace_types::apps_responses::AppsAuditEvent;

/// Who a provisioned install names as its installer: no member made it.
pub const PROVISIONING_INSTALLER: &str = "workspace-provisioning";

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// Installs each of `bundles` the workspace does not have yet, `trusted` being the first-party
    /// keys (`FIRST_PARTY_PUBLISHER_KEYS` in production).
    pub async fn provision_first_party_apps(
        &self,
        bundles: &[(&str, SignedBundle<'_>)],
        trusted: &[&str],
    ) -> Result<(), NetworkError> {
        if bundles.is_empty() {
            return Ok(());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| NetworkError::msg(format!("The server clock is before the epoch: {e}")))?
            .as_millis() as u64;
        let scope = InstallScope::Workspace;
        let scope_key = scope
            .scope_key()
            .ok_or_else(|| NetworkError::msg("The workspace scope has no key"))?;
        let backend = &self.domain_operations.backend_tx_manager;
        let _guard = APPS_LOCK.lock().await;
        let mut recorded = backend.first_party_releases().await?;
        let audit = backend.apps_audit().await?;
        for (name, bundle) in bundles {
            let provisioning = plan_provisioning(bundle, trusted).map_err(|why| {
                NetworkError::msg(format!(
                    "The first-party release {name} is refused: {why:?}"
                ))
            })?;
            // The module before the record, so a listed release always has its module stored.
            if let Provisioning::List { manifest, module } = &provisioning {
                let sha256 = &manifest.artifact.sha256;
                if backend.artifact_meta(sha256).await?.is_none() {
                    backend.store_artifact(sha256, module).await?;
                }
            }
            let manifest = provisioning.manifest();
            let manifest_text = std::str::from_utf8(bundle.manifest)
                .map_err(|_| NetworkError::msg("A signed manifest is not UTF-8"))?;
            let release = StoredRelease {
                manifest: manifest_text.to_string(),
                signature: bundle.signature.trim().to_string(),
            };
            let provisioned_before = recorded
                .insert(manifest.id.clone(), release.clone())
                .is_some()
                || audit
                    .iter()
                    .any(|e| e.actor == PROVISIONING_INSTALLER && e.app_id == manifest.id);
            backend.save_first_party_releases(&recorded).await?;
            let Provisioning::Install(plan) = &provisioning else {
                info!(target: "citadel", "Listed the first-party app {} {} for the workspace", manifest.id, manifest.version);
                continue;
            };
            let mut installed = false;
            for id in backend.app_install_ids_at(&scope_key).await? {
                installed |= backend
                    .app_install(&id)
                    .await?
                    .is_some_and(|existing| existing.app_id == manifest.id);
            }
            if installed || provisioned_before {
                continue;
            }
            let manifest_sha256 = hex::encode(sha256(bundle.manifest));
            backend.save_app_release(&manifest_sha256, &release).await?;
            let record = AppInstall {
                id: uuid::Uuid::new_v4().to_string(),
                app_id: manifest.id.clone(),
                version: manifest.version.clone(),
                manifest_sha256,
                artifact_sha256: manifest.artifact.sha256.clone(),
                pinned_publisher_key: manifest.publisher.mldsa65_public_key.clone(),
                scope: scope.clone(),
                granted: plan.granted.clone(),
                details: plan.details.clone(),
                installed_by: PROVISIONING_INSTALLER.to_string(),
                installed_at_ms: now,
                state: InstallState::Active,
                previous: None,
                injected_header_into: Vec::new(),
                source: ListingSource::FirstParty,
            };
            backend.save_app_install(&record).await?;
            let event = AppsAuditEvent::Installed {
                scope: scope.clone(),
            };
            let entry = audit_entry(
                now,
                PROVISIONING_INSTALLER,
                &record.app_id,
                Some(&record.id),
                event,
            );
            backend.push_apps_audit([entry]).await?;
            info!(target: "citadel", "Provisioned the first-party app {} {} for the workspace", record.app_id, record.version);
        }
        Ok(())
    }
}
