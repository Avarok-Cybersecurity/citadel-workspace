//! What the apps store keeps, and under which keys (design 2.5, under the kernel's prefix):
//!
//! - `citadel_workspace.apps.install.<id>`: one `AppInstall`.
//! - `citadel_workspace.apps.scope.<scope key>`: the ids of the installs at that scope, a
//!   "Just for me" install's under `self:<username>`.
//! - `citadel_workspace.apps.scopes`: which scope keys have installs, so every install can be
//!   found without a key scan.
//! - `citadel_workspace.apps.user.<username>`: the installs that member hid for themselves.
//! - `citadel_workspace.apps.pending.<install id>`: the release an install waits on consent for.
//! - `citadel_workspace.apps.registry.<entry id>` and `.registry_index`: this workspace's
//!   listings. An entry's id is its app's id: one entry per app, at its newest version.
//! - `citadel_workspace.apps.release.<manifest sha256>`: a signed manifest, verbatim.
//! - `citadel_workspace.apps.artifact.<sha256>` and `.artifact_chunk.<sha256>.<n>`: a wasm
//!   module, content-addressed, in chunks a Durable Object's value limit admits.
//! - `citadel_workspace.apps.upload.<username>` and `.upload_chunk.<n>.<username>`: the one
//!   artifact a member is uploading.
//! - `citadel_workspace.apps.audit`: the audit log, at most `MAX_AUDIT_ENTRIES`.
//! - `citadel_workspace.apps.ledger.<root>`: what one app holds at one scope
//!   (`storage::StorageLedger`); `.kvindex.<namespace>` one KV's keys, `.kv.<namespace>.<key>`
//!   one value, `.blob.<root>.<sha256>` and `.blob_chunk.<root>.<sha256>.<n>` one blob. Every
//!   `<...>` here is a digest (`storage::StorageRoot`), never an app's own text.
//!
//! A release or artifact is deleted once no install (running, previous or pending) and no
//! registry entry names it.

use citadel_workspace_types::apps::peer::{PeerConsent, PeerForMe};
use citadel_workspace_types::apps::AppAudience;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const PREFIX: &str = "citadel_workspace.apps.";

pub(crate) const SCOPES_KEY: &str = "citadel_workspace.apps.scopes";
pub(crate) const REGISTRY_INDEX_KEY: &str = "citadel_workspace.apps.registry_index";
pub(crate) const AUDIT_KEY: &str = "citadel_workspace.apps.audit";

/// The telemetry access log's bound: the log is one record, read and written whole.
pub const MAX_AUDIT_ENTRIES: usize = 2000;
/// How many audit entries one `ListAudit` page holds.
pub const AUDIT_PAGE: usize = 100;

pub(crate) fn install_key(id: &str) -> String {
    format!("{PREFIX}install.{id}")
}

pub(crate) fn scope_key(scope_key: &str) -> String {
    format!("{PREFIX}scope.{scope_key}")
}

pub(crate) fn user_key(username: &str) -> String {
    format!("{PREFIX}user.{username}")
}

pub(crate) fn pending_key(install_id: &str) -> String {
    format!("{PREFIX}pending.{install_id}")
}

pub(crate) fn registry_key(entry_id: &str) -> String {
    format!("{PREFIX}registry.{entry_id}")
}

pub(crate) fn release_key(manifest_sha256: &str) -> String {
    format!("{PREFIX}release.{manifest_sha256}")
}

pub(crate) fn artifact_key(sha256: &str) -> String {
    format!("{PREFIX}artifact.{sha256}")
}

pub(crate) fn artifact_chunk_key(sha256: &str, index: u32) -> String {
    format!("{PREFIX}artifact_chunk.{sha256}.{index}")
}

pub(crate) fn upload_key(username: &str) -> String {
    format!("{PREFIX}upload.{username}")
}

/// Index first: a username may hold dots, a number does not.
pub(crate) fn upload_chunk_key(username: &str, index: u32) -> String {
    format!("{PREFIX}upload_chunk.{index}.{username}")
}

pub(crate) fn ledger_key(root_id: &str) -> String {
    format!("{PREFIX}ledger.{root_id}")
}

pub(crate) fn kv_index_key(namespace_id: &str) -> String {
    format!("{PREFIX}kvindex.{namespace_id}")
}

pub(crate) fn kv_value_key(namespace_id: &str, key_id: &str) -> String {
    format!("{PREFIX}kv.{namespace_id}.{key_id}")
}

pub(crate) fn blob_key(root_id: &str, sha256: &str) -> String {
    format!("{PREFIX}blob.{root_id}.{sha256}")
}

pub(crate) fn blob_chunk_key(root_id: &str, sha256: &str, index: u32) -> String {
    format!("{PREFIX}blob_chunk.{root_id}.{sha256}.{index}")
}

/// One release of an app: which manifest and which module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseRef {
    pub version: String,
    pub manifest_sha256: String,
    pub artifact_sha256: String,
}

/// A signed manifest, its exact bytes (JSON, so UTF-8) and its detached signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredRelease {
    pub manifest: String,
    pub signature: String,
}

/// A listing in this workspace's registry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub entry_id: String,
    pub release: ReleaseRef,
    /// The manifest's, kept beside it so a catalogue read decides without parsing manifests.
    pub audience: AppAudience,
    pub published_by: String,
    pub published_at_ms: u64,
}

/// The release an install waits on consent for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingRelease {
    pub release: ReleaseRef,
    pub publisher_key: String,
}

/// A member's own view of the installs that reach them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserApps {
    pub disabled: BTreeSet<String>,
    /// Install id to what this member allowed of its peer-to-peer and topic capabilities, and
    /// whom they blocked. Absent from records written before it existed: nothing allowed.
    #[serde(default)]
    pub peer: BTreeMap<String, PeerSettings>,
}

/// One install's peer settings for one member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerSettings {
    pub consent: PeerConsent,
    pub blocked: BTreeSet<String>,
}

impl UserApps {
    /// What this member allowed for `install_id`: `PeerConsent::NONE` if they never said.
    pub fn consent(&self, install_id: &str) -> PeerConsent {
        self.peer
            .get(install_id)
            .map_or(PeerConsent::NONE, |p| p.consent)
    }

    pub fn blocked(&self, install_id: &str) -> BTreeSet<String> {
        self.peer
            .get(install_id)
            .map(|p| p.blocked.clone())
            .unwrap_or_default()
    }

    /// The settings as the member reads them back, for the installs in `ids`.
    pub fn for_me<'a>(&self, ids: impl IntoIterator<Item = &'a str>) -> Vec<PeerForMe> {
        ids.into_iter()
            .filter_map(|id| {
                let p = self.peer.get(id)?;
                Some(PeerForMe {
                    install_id: id.to_string(),
                    consent: p.consent,
                    blocked: p.blocked.iter().cloned().collect(),
                })
            })
            .collect()
    }
}

/// A stored artifact: `total_chunks` chunks of `chunk_bytes`, the last shorter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactMeta {
    pub bytes: u32,
    pub chunk_bytes: u32,
    pub total_chunks: u32,
}

/// The artifact a member is uploading, and which chunks have arrived.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadStaging {
    pub sha256: String,
    pub total_chunks: u32,
    pub received: BTreeSet<u32>,
    /// Every chunk arrived and the whole hashes to `sha256`.
    pub complete: bool,
}
