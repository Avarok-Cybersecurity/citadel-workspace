//! The apps store's I/O: installs and their scope index, each member's hidden installs, the
//! releases waiting on consent, the registry, the signed manifests and the audit log
//! (`kernel::apps::records`). Artifacts are `apps_artifact_store`. Nothing is decided here.
//!
//! Every read-modify-write is made under `APPS_LOCK`, which the caller takes: an index is one
//! record, so two writers interleaving would lose one's change, and two installs of one app at
//! one scope must see each other.

use super::BackendTransactionManager;
use crate::kernel::apps::records::*;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_install::AppInstall;
use citadel_workspace_types::apps_responses::AppsAuditEntry;
use std::collections::BTreeSet;

/// Serialises every apps read-modify-write. Installs are made by people, not machines.
pub(crate) static APPS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn key_of(install: &AppInstall) -> Result<String, NetworkError> {
    install
        .scope
        .scope_key()
        .ok_or_else(|| NetworkError::msg("An install's scope has no key"))
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub(crate) async fn app_install(&self, id: &str) -> Result<Option<AppInstall>, NetworkError> {
        self.backend_get(&install_key(id)).await
    }

    pub(crate) async fn app_install_ids_at(
        &self,
        scope: &str,
    ) -> Result<BTreeSet<String>, NetworkError> {
        Ok(self
            .backend_get(&scope_key(scope))
            .await?
            .unwrap_or_default())
    }

    async fn app_scopes(&self) -> Result<BTreeSet<String>, NetworkError> {
        Ok(self.backend_get(SCOPES_KEY).await?.unwrap_or_default())
    }

    /// Every install in the workspace, by scope key.
    pub(crate) async fn all_app_installs(&self) -> Result<Vec<AppInstall>, NetworkError> {
        let mut installs = Vec::new();
        for scope in self.app_scopes().await? {
            for id in self.app_install_ids_at(&scope).await? {
                if let Some(install) = self.app_install(&id).await? {
                    installs.push(install);
                }
            }
        }
        Ok(installs)
    }

    /// Store `install`, new or changed, and list it at its scope.
    pub(crate) async fn save_app_install(&self, install: &AppInstall) -> Result<(), NetworkError> {
        let scope = key_of(install)?;
        self.backend_save(&install_key(&install.id), install)
            .await?;
        let mut ids = self.app_install_ids_at(&scope).await?;
        if ids.insert(install.id.clone()) {
            self.backend_save(&scope_key(&scope), &ids).await?;
        }
        let mut scopes = self.app_scopes().await?;
        if scopes.insert(scope) {
            self.backend_save(SCOPES_KEY, &scopes).await?;
        }
        Ok(())
    }

    /// Remove `install`: its record first, so it stops running before anything else changes.
    pub(crate) async fn remove_app_install(
        &self,
        install: &AppInstall,
    ) -> Result<(), NetworkError> {
        let scope = key_of(install)?;
        self.backend_delete(&install_key(&install.id)).await?;
        self.backend_delete(&pending_key(&install.id)).await?;
        let mut ids = self.app_install_ids_at(&scope).await?;
        if ids.remove(&install.id) {
            if ids.is_empty() {
                self.backend_delete(&scope_key(&scope)).await?;
                let mut scopes = self.app_scopes().await?;
                scopes.remove(&scope);
                self.backend_save(SCOPES_KEY, &scopes).await?;
            } else {
                self.backend_save(&scope_key(&scope), &ids).await?;
            }
        }
        Ok(())
    }

    pub(crate) async fn app_pending(
        &self,
        install_id: &str,
    ) -> Result<Option<PendingRelease>, NetworkError> {
        self.backend_get(&pending_key(install_id)).await
    }

    pub(crate) async fn save_app_pending(
        &self,
        install_id: &str,
        pending: Option<&PendingRelease>,
    ) -> Result<(), NetworkError> {
        match pending {
            Some(pending) => self.backend_save(&pending_key(install_id), pending).await,
            None => self.backend_delete(&pending_key(install_id)).await,
        }
    }

    pub(crate) async fn user_apps(&self, username: &str) -> Result<UserApps, NetworkError> {
        Ok(self
            .backend_get(&user_key(username))
            .await?
            .unwrap_or_default())
    }

    pub(crate) async fn save_user_apps(
        &self,
        username: &str,
        apps: &UserApps,
    ) -> Result<(), NetworkError> {
        if *apps == UserApps::default() {
            return self.backend_delete(&user_key(username)).await;
        }
        self.backend_save(&user_key(username), apps).await
    }

    pub(crate) async fn registry_entry(
        &self,
        entry_id: &str,
    ) -> Result<Option<RegistryEntry>, NetworkError> {
        self.backend_get(&registry_key(entry_id)).await
    }

    pub(crate) async fn registry_entries(&self) -> Result<Vec<RegistryEntry>, NetworkError> {
        let ids: BTreeSet<String> = self
            .backend_get(REGISTRY_INDEX_KEY)
            .await?
            .unwrap_or_default();
        let mut entries = Vec::new();
        for id in ids {
            if let Some(entry) = self.registry_entry(&id).await? {
                entries.push(entry);
            }
        }
        Ok(entries)
    }

    pub(crate) async fn save_registry_entry(
        &self,
        entry: &RegistryEntry,
    ) -> Result<(), NetworkError> {
        self.backend_save(&registry_key(&entry.entry_id), entry)
            .await?;
        let mut ids: BTreeSet<String> = self
            .backend_get(REGISTRY_INDEX_KEY)
            .await?
            .unwrap_or_default();
        if ids.insert(entry.entry_id.clone()) {
            self.backend_save(REGISTRY_INDEX_KEY, &ids).await?;
        }
        Ok(())
    }

    pub(crate) async fn app_release(
        &self,
        manifest_sha256: &str,
    ) -> Result<Option<StoredRelease>, NetworkError> {
        self.backend_get(&release_key(manifest_sha256)).await
    }

    pub(crate) async fn save_app_release(
        &self,
        manifest_sha256: &str,
        release: &StoredRelease,
    ) -> Result<(), NetworkError> {
        self.backend_save(&release_key(manifest_sha256), release)
            .await
    }

    pub(crate) async fn delete_app_release(
        &self,
        manifest_sha256: &str,
    ) -> Result<(), NetworkError> {
        self.backend_delete(&release_key(manifest_sha256)).await
    }

    /// Oldest first.
    pub(crate) async fn apps_audit(&self) -> Result<Vec<AppsAuditEntry>, NetworkError> {
        Ok(self.backend_get(AUDIT_KEY).await?.unwrap_or_default())
    }

    /// Append `entries`, dropping the oldest past `MAX_AUDIT_ENTRIES`.
    pub(crate) async fn push_apps_audit(
        &self,
        entries: impl IntoIterator<Item = AppsAuditEntry>,
    ) -> Result<(), NetworkError> {
        let mut log = self.apps_audit().await?;
        log.extend(entries);
        let excess = log.len().saturating_sub(MAX_AUDIT_ENTRIES);
        log.drain(..excess);
        self.backend_save(AUDIT_KEY, &log).await
    }
}
