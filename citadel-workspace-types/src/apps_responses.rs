//! The workspace server's answers to apps requests, and the apps audit log.
//!
//! Byte fields print only their length when logged, as in `apps_protocol`.

use crate::apps::peer::{PeerConsent, PeerDirection, PeerForMe};
use crate::apps::{Capability, InstallScope};
use crate::apps_install::{AppInstall, AppsRefusal, ListingSource};
use crate::apps_protocol::IhttpFrom;
use citadel_internal_service_types::plaintext_debug_fmt;
use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A listing as the catalogue and the registry hold it: the publisher's exact bytes, so the
/// client verifies the signature itself before it shows anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppListing {
    pub source: ListingSource,
    #[debug(with = plaintext_debug_fmt)]
    pub manifest_bytes: Vec<u8>,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppsAuditEntry {
    #[ts(type = "bigint")]
    pub at_ms: u64,
    pub actor: String,
    pub app_id: String,
    pub install_id: Option<String>,
    pub event: AppsAuditEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AppsAuditEvent {
    Published {
        version: String,
    },
    Installed {
        scope: InstallScope,
    },
    Consented {
        version: String,
    },
    Updated {
        from: String,
        to: String,
    },
    RolledBack {
        to: String,
    },
    Suspended {
        reason: String,
    },
    Uninstalled {
        purged_storage: bool,
    },
    HeaderInjected {
        node_id: String,
    },
    HeaderRemoved {
        node_id: String,
    },
    /// Refused calls are counted per install, capability and day, never logged one by one.
    CallsRefused {
        capability: Capability,
        /// Days since the Unix epoch.
        day: u32,
        count: u32,
    },
    InstallRequested {
        node_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AppsResponse {
    Catalogue {
        listings: Vec<AppListing>,
    },
    Listing {
        listing: AppListing,
    },
    Installs {
        installs: Vec<AppInstall>,
        /// The ids among `installs` the caller hid for themselves.
        disabled_for_me: Vec<String>,
        /// The caller's peer settings, for the installs among `installs` they ever set them on;
        /// any other install has `PeerConsent::NONE` and no blocks.
        peer_for_me: Vec<PeerForMe>,
    },
    /// An install's running release and, when it waits on consent, the one it waits on. Not
    /// `pending`: the client's JSON codec reads that name as a bigint wherever it appears.
    Release {
        install_id: String,
        current: AppListing,
        waiting_on: Option<AppListing>,
    },
    Published {
        entry_id: String,
    },
    ArtifactChunkStored {
        sha256: String,
        index: u32,
    },
    Installed {
        install: AppInstall,
    },
    Uninstalled {
        install_id: String,
    },
    /// Updated, or waiting for consent: the install says which.
    Updated {
        install: AppInstall,
    },
    UpToDate {
        install_id: String,
    },
    RolledBack {
        install: AppInstall,
    },
    Consented {
        install: AppInstall,
    },
    DisabledForMe {
        install_id: String,
        disabled: bool,
    },
    PeerConsentForMe {
        install_id: String,
        consent: PeerConsent,
    },
    PeerBlockedForMe {
        install_id: String,
        username: String,
        blocked: bool,
    },
    /// The peer may reach (or be reached) until `until_ms`.
    PeerAuthorized {
        install_id: String,
        peer: IhttpFrom,
        direction: PeerDirection,
        #[ts(type = "bigint")]
        until_ms: u64,
    },
    TopicGroup {
        install_id: String,
        topic: String,
        group_key: Option<String>,
    },
    ArtifactChunk {
        sha256: String,
        index: u32,
        total_chunks: u32,
        #[debug(with = plaintext_debug_fmt)]
        bytes: Vec<u8>,
    },
    Audit {
        entries: Vec<AppsAuditEntry>,
    },
    InstallRequested,
    /// Pushed to the workspace's other members when an install was made, changed or removed:
    /// read the installs again. Content-free, so it tells no one about an install they cannot see.
    InstallsChanged,
    /// Pushed to the workspace's other members when one changed their own answers for an install
    /// (consent, blocks, turned off for me): what `AuthorizePeer` says may have changed. Content-free.
    PeerAnswersChanged,
    /// CBOR of the SDK's `HostReply`.
    CallReply {
        #[debug(with = plaintext_debug_fmt)]
        reply: Vec<u8>,
    },
    Advertised {
        #[ts(type = "bigint")]
        until_ms: u64,
    },
    /// `WithdrawService` taken: how many relayed streams it ended.
    Withdrawn {
        install_id: String,
        closed_streams: u32,
    },
    IhttpSent,
    /// A relayed frame for one of the caller's running apps.
    IhttpFrame {
        from: IhttpFrom,
        to_install_id: String,
        #[debug(with = plaintext_debug_fmt)]
        frame: Vec<u8>,
    },
    Refused(AppsRefusal),
}
