//! Installing the first-party apps every workspace is provisioned with (Calendar design §3.2): each
//! release the server embeds (`apps::first_party_bundles`), once, as an Active install for the
//! whole workspace, with the release stored for it. Decided by `apps::first_party`.
//!
//! Run at every provisioning pass, so it is idempotent: an app installed for the workspace already
//! is left as it is, whatever its version (an update is an admin's, as for any install). A release
//! the decision refuses fails the pass: the deploy checked it, so a refusal here is a release that
//! should not run, not one to skip.

use super::apps::audit_entry;
use crate::kernel::apps::first_party::{plan_provisioning, SignedBundle};
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
        for (name, bundle) in bundles {
            let plan = plan_provisioning(bundle, trusted).map_err(|why| {
                NetworkError::msg(format!(
                    "The first-party release {name} is refused: {why:?}"
                ))
            })?;
            let manifest = &plan.manifest;
            let mut installed = false;
            for id in backend.app_install_ids_at(&scope_key).await? {
                installed |= backend
                    .app_install(&id)
                    .await?
                    .is_some_and(|existing| existing.app_id == manifest.id);
            }
            if installed {
                continue;
            }
            let manifest_text = std::str::from_utf8(bundle.manifest)
                .map_err(|_| NetworkError::msg("A signed manifest is not UTF-8"))?;
            let manifest_sha256 = hex::encode(sha256(bundle.manifest));
            let release = StoredRelease {
                manifest: manifest_text.to_string(),
                signature: bundle.signature.trim().to_string(),
            };
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
