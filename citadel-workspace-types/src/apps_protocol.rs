//! The apps requests a member sends the workspace server. The answers are `apps_responses`.
//!
//! Every byte field prints only its length when a request is logged: manifests, artifacts,
//! host calls and internal-HTTP frames are the app's data.

use crate::apps::{Capability, InstallScope};
use citadel_internal_service_types::plaintext_debug_fmt;
use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Artifacts and uploads travel in chunks of at most this many bytes. A chunk's bytes are a
/// JSON array of numbers on the wire, up to four characters a byte, so 256 KiB keeps one
/// request near 1 MiB, far under a tenant's `max_frame_bytes` (`billing/tiers.json`).
pub const ARTIFACT_CHUNK_BYTES: u32 = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AppsRequest {
    /// The global catalogue, and this workspace's listings whose audience admits the caller.
    ListCatalogue,
    /// One listing; `Unavailable` for one the caller may not see, as for one that is not there.
    GetListing { app_id: String },
    /// The installs that reach the caller, and those they installed.
    ListInstalls,
    /// Register an app in this workspace's registry (`AppPublish`), its audience not global.
    /// The artifact is uploaded first with `UploadArtifactChunk`.
    Publish {
        #[debug(with = plaintext_debug_fmt)]
        manifest_bytes: Vec<u8>,
        /// The `app.mldsa.sig` text.
        signature: String,
    },
    /// One chunk of an artifact the caller uploads rather than the server fetching it.
    UploadArtifactChunk {
        sha256: String,
        index: u32,
        total_chunks: u32,
        #[debug(with = plaintext_debug_fmt)]
        bytes: Vec<u8>,
    },
    /// Install a listed app. `granted` is what the installer consents to, at most what the
    /// manifest asks; `pinned_publisher_key` is the key the consent screen showed. `app_id` and
    /// `version` must be the listing's.
    Install {
        app_id: String,
        version: String,
        listing: ListingOffer,
        scope: InstallScope,
        granted: Vec<Capability>,
        pinned_publisher_key: String,
        /// Write the app into the scope node's required-apps header (`AppManage` and `EditMdx`
        /// on the node, `Node` or `NodeTree` scope only).
        inject_requirement: bool,
    },
    /// By the installer or `AppManage`. `purge_storage` must be said either way.
    Uninstall {
        install_id: String,
        purge_storage: bool,
    },
    /// Take a newer version from `listing` (the install's own registry entry, or a newer signed
    /// manifest for an install that came from one) if nothing new is asked; otherwise the
    /// install waits in `NeedsConsent`, still running the version it has.
    Update {
        install_id: String,
        listing: ListingOffer,
    },
    /// `AppManage`: back to the recorded previous release.
    Rollback { install_id: String },
    /// Accept the version an install is waiting on, with this grant, signed by this key (the one
    /// the consent screen showed).
    Consent {
        install_id: String,
        version: String,
        granted: Vec<Capability>,
        pinned_publisher_key: String,
    },
    /// Hide (or show again) an install for the caller only. It is not uninstalled.
    SetDisabledForMe { install_id: String, disabled: bool },
    /// One chunk of a stored artifact, by digest.
    FetchArtifact { sha256: String, index: u32 },
    /// The signed manifest of an install's running release, and of the one it waits on, so the
    /// client verifies the signature itself before it instantiates anything.
    GetRelease { install_id: String },
    /// `AppManage`: the apps audit log, newest first, a page after `before_ms` if given.
    ListAudit {
        #[ts(type = "bigint | null")]
        before_ms: Option<u64>,
    },
    /// Ask whoever holds `AppManage` to install `app_id` where `node_id` needs it.
    RequestInstall { app_id: String, node_id: String },
    /// A server-backed host call from a running app: CBOR of the SDK's `HostCall`.
    Call {
        install_id: String,
        #[debug(with = plaintext_debug_fmt)]
        call: Vec<u8>,
    },
    /// The caller's host serves this install's routes until `until_ms` (repeated while mounted).
    AdvertiseService {
        install_id: String,
        /// Hex sha256 of the route list served.
        routes_digest: String,
        #[ts(type = "bigint")]
        until_ms: u64,
    },
    /// Relay one internal-HTTP frame (CBOR of `citadel_ihttp_types::IhttpFrame`) through the
    /// server, when there is no P2P session or the address is a scope.
    IhttpSend {
        from_install_id: String,
        to: IhttpAddress,
        #[debug(with = plaintext_debug_fmt)]
        frame: Vec<u8>,
    },
}

/// Where the manifest an install or update takes comes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ListingOffer {
    /// This workspace's registry entry (`Published { entry_id }`), at its current version.
    Registry { entry_id: String },
    /// A signed manifest the installer holds: a global catalogue listing the client verified,
    /// or the installer's own. The server verifies the signature and the artifact itself.
    Signed {
        #[debug(with = plaintext_debug_fmt)]
        manifest_bytes: Vec<u8>,
        /// The `app.mldsa.sig` text.
        signature: String,
    },
}

/// Where an internal-HTTP request goes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum IhttpAddress {
    /// This member's host serving `app_id`.
    User { app_id: String, username: String },
    /// Any host currently serving `app_id` for this install scope.
    Scope { app_id: String, scope_key: String },
}

/// Who sent a relayed frame, stamped by the server from the session, never by an app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IhttpFrom {
    pub username: String,
    #[ts(type = "bigint")]
    pub cid: u64,
    pub app_id: String,
    pub install_id: String,
}
