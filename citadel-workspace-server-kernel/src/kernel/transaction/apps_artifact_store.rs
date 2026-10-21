//! Artifacts at rest and in upload, and the sweep that drops releases and artifacts nothing
//! names any more. The caller holds `APPS_LOCK` (`apps_store`).
//!
//! A chunk is stored as base64 text: a Durable Object stores a value of at most 2 MB, and a
//! 1 MiB chunk as a JSON array of numbers would be over three.

use super::BackendTransactionManager;
use crate::kernel::apps::artifact::chunks;
use crate::kernel::apps::records::*;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_protocol::ARTIFACT_CHUNK_BYTES;
use std::collections::BTreeSet;

fn decode(text: &str, key: &str) -> Result<Vec<u8>, NetworkError> {
    STANDARD
        .decode(text)
        .map_err(|e| NetworkError::msg(format!("{key} is not base64: {e}")))
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub(crate) async fn artifact_meta(
        &self,
        sha256: &str,
    ) -> Result<Option<ArtifactMeta>, NetworkError> {
        self.backend_get(&artifact_key(sha256)).await
    }

    pub(crate) async fn artifact_chunk(
        &self,
        sha256: &str,
        index: u32,
    ) -> Result<Option<Vec<u8>>, NetworkError> {
        let key = artifact_chunk_key(sha256, index);
        let text: Option<String> = self.backend_get(&key).await?;
        text.map(|text| decode(&text, &key)).transpose()
    }

    /// Store `bytes`, which the caller verified are the module `sha256` names. The chunks go
    /// first and the meta last, so a reader never finds a meta without its chunks.
    pub(crate) async fn store_artifact(
        &self,
        sha256: &str,
        bytes: &[u8],
    ) -> Result<(), NetworkError> {
        let mut total_chunks = 0u32;
        for (index, chunk) in chunks(bytes).enumerate() {
            let index = u32::try_from(index).map_err(|_| NetworkError::msg("Too many chunks"))?;
            self.backend_save(&artifact_chunk_key(sha256, index), &STANDARD.encode(chunk))
                .await?;
            total_chunks = index + 1;
        }
        let meta = ArtifactMeta {
            bytes: u32::try_from(bytes.len()).map_err(|_| NetworkError::msg("Too large"))?,
            chunk_bytes: ARTIFACT_CHUNK_BYTES,
            total_chunks,
        };
        self.backend_save(&artifact_key(sha256), &meta).await
    }

    async fn delete_artifact(&self, sha256: &str) -> Result<(), NetworkError> {
        let Some(meta) = self.artifact_meta(sha256).await? else {
            return Ok(());
        };
        self.backend_delete(&artifact_key(sha256)).await?;
        for index in 0..meta.total_chunks {
            self.backend_delete(&artifact_chunk_key(sha256, index))
                .await?;
        }
        Ok(())
    }

    pub(crate) async fn app_upload(
        &self,
        username: &str,
    ) -> Result<Option<UploadStaging>, NetworkError> {
        self.backend_get(&upload_key(username)).await
    }

    pub(crate) async fn save_app_upload(
        &self,
        username: &str,
        staging: &UploadStaging,
    ) -> Result<(), NetworkError> {
        self.backend_save(&upload_key(username), staging).await
    }

    pub(crate) async fn save_app_upload_chunk(
        &self,
        username: &str,
        index: u32,
        bytes: &[u8],
    ) -> Result<(), NetworkError> {
        self.backend_save(&upload_chunk_key(username, index), &STANDARD.encode(bytes))
            .await
    }

    /// The uploaded chunks in order, or `None` if one is missing.
    pub(crate) async fn assemble_app_upload(
        &self,
        username: &str,
        staging: &UploadStaging,
    ) -> Result<Option<Vec<u8>>, NetworkError> {
        let mut bytes = Vec::new();
        for index in 0..staging.total_chunks {
            let key = upload_chunk_key(username, index);
            let Some(text) = self.backend_get::<String>(&key).await? else {
                return Ok(None);
            };
            bytes.extend(decode(&text, &key)?);
        }
        Ok(Some(bytes))
    }

    /// Forget `username`'s upload and every chunk it may hold.
    pub(crate) async fn drop_app_upload(&self, username: &str) -> Result<(), NetworkError> {
        let Some(staging) = self.app_upload(username).await? else {
            return Ok(());
        };
        for index in 0..staging.total_chunks {
            self.backend_delete(&upload_chunk_key(username, index))
                .await?;
        }
        self.backend_delete(&upload_key(username)).await
    }

    /// Delete those of `manifests` and `artifacts` that no install (running, previous or
    /// pending) and no registry entry names.
    pub(crate) async fn sweep_apps_releases(
        &self,
        manifests: &[String],
        artifacts: &[String],
    ) -> Result<(), NetworkError> {
        let mut named_manifests = BTreeSet::new();
        let mut named_artifacts = BTreeSet::new();
        let mut name = |release: &ReleaseRef| {
            named_manifests.insert(release.manifest_sha256.clone());
            named_artifacts.insert(release.artifact_sha256.clone());
        };
        for install in self.all_app_installs().await? {
            name(&ReleaseRef {
                version: install.version.clone(),
                manifest_sha256: install.manifest_sha256.clone(),
                artifact_sha256: install.artifact_sha256.clone(),
            });
            if let Some(previous) = &install.previous {
                name(&ReleaseRef {
                    version: previous.version.clone(),
                    manifest_sha256: previous.manifest_sha256.clone(),
                    artifact_sha256: previous.artifact_sha256.clone(),
                });
            }
            if let Some(pending) = self.app_pending(&install.id).await? {
                name(&pending.release);
            }
        }
        for entry in self.registry_entries().await? {
            name(&entry.release);
        }
        for sha in manifests.iter().filter(|s| !named_manifests.contains(*s)) {
            self.delete_app_release(sha).await?;
        }
        for sha in artifacts.iter().filter(|s| !named_artifacts.contains(*s)) {
            self.delete_artifact(sha).await?;
        }
        Ok(())
    }
}
