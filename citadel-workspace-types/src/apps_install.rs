//! An install of an app, as the kernel stores it and members see it, and why a request about
//! one is refused.

use crate::apps::{Capability, InstallScope};
use crate::structs::Permission;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use ts_rs::TS;

/// One app installed for one scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppInstall {
    pub id: String,
    pub app_id: String,
    pub version: String,
    /// Hex sha256 of the manifest's exact published bytes.
    pub manifest_sha256: String,
    /// Hex sha256 of the wasm module.
    pub artifact_sha256: String,
    /// The publisher key the installer accepted (3904 hex). Every load and update is verified
    /// against this key; a different key needs consent again.
    pub pinned_publisher_key: String,
    pub scope: InstallScope,
    /// What the installer granted: never more than the manifest asks for.
    pub granted: BTreeSet<Capability>,
    /// The hosts, routes and targets of the granted network and internal-HTTP capabilities.
    pub details: GrantDetails,
    pub installed_by: String,
    #[ts(type = "bigint")]
    pub installed_at_ms: u64,
    pub state: InstallState,
    /// The release a rollback returns to, kept until the next update replaces it.
    pub previous: Option<PreviousRelease>,
    /// Nodes whose required-apps header this install wrote, so uninstalling removes exactly
    /// those entries and never one a person wrote.
    pub injected_header_into: Vec<String>,
    pub source: ListingSource,
}

/// The parameters of the granted capabilities that take them. Each list is empty when its
/// capability is not granted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GrantDetails {
    /// `net.host`: hosts reached from the member's machine.
    pub host_network_hosts: Vec<String>,
    /// `net.server`: hosts reached from the workspace server.
    pub server_network_hosts: Vec<String>,
    /// `ihttp.serve`: `METHOD /path` patterns served.
    pub ihttp_routes: Vec<String>,
    /// `ihttp.call`: other apps' ids that may be called, besides the app's own.
    pub ihttp_call_targets: Vec<String>,
    /// `ihttp.p2p.serve`: the patterns served peer to peer. Absent from installs made before
    /// it existed, which could not have been granted it: empty.
    #[serde(default)]
    pub ihttp_p2p_routes: Vec<String>,
    /// `group.topic.*`: the app's topics. Absent from older installs, as above: empty.
    #[serde(default)]
    pub topics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PreviousRelease {
    pub version: String,
    pub manifest_sha256: String,
    pub artifact_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum InstallState {
    Active,
    /// `version` is waiting for someone with authority to consent; the installed version keeps
    /// running meanwhile.
    NeedsConsent {
        version: String,
        reason: ConsentReason,
    },
    Suspended {
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ConsentReason {
    /// The new version asks for capabilities the install was not granted.
    CapabilitiesGrew,
    /// The new version is signed by a different publisher key.
    PublisherKeyChanged,
}

/// Where the install's listing came from, and so where updates are looked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ListingSource {
    /// The signed global catalogue at this version.
    Global {
        #[ts(type = "bigint")]
        catalogue_version: u64,
    },
    /// This workspace's own registry.
    WorkspaceRegistry { entry_id: String },
    /// Uploaded by the installer, for a scope of their own.
    Upload,
}

/// Why an apps request was refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AppsRefusal {
    /// No such app or install, or one the caller may not see: one answer for both, so an
    /// audience cannot be probed.
    Unavailable,
    /// The caller does not hold this permission (where it does not reveal anything).
    PermissionRequired(Permission),
    /// The installer may not grant this capability.
    CapabilityNotGrantable(Capability),
    /// Only the first-party publisher may be granted this capability.
    FirstPartyOnly(Capability),
    /// The manifest does not ask for this capability, so it cannot be granted.
    NotRequested(Capability),
    /// The manifest marks this capability required; an install without it is refused.
    RequiredCapabilityLeftOut(Capability),
    /// The app does not support this kind of scope.
    ScopeNotSupported,
    /// The scope would reach people outside the app's audience.
    ScopeOutsideAudience,
    /// The install does not have this capability for this call.
    Ungranted(Capability),
    /// The manifest is malformed; the reason says which field.
    InvalidManifest(String),
    /// The signature does not verify under the publisher key.
    BadSignature,
    /// The artifact's bytes do not match the manifest's digest or size.
    ArtifactMismatch,
    /// An update must be a strictly greater version.
    VersionNotNewer,
    /// The install is waiting for consent, or suspended.
    NotActive,
    /// A host limit (rate, size, quota) was reached; the reason says which.
    Limit(String),
    /// The network policy refused, whatever the reason.
    Policy,
    /// No member currently serves this internal-HTTP address.
    NoHost,
    /// Only workspace admins may change a document's required-apps header.
    HeaderManaged,
    /// This server was built without what the request needs (e.g. fetching artifacts by URL),
    /// or the request belongs to a part of the platform this server does not run yet.
    ServerFeatureUnavailable,
    /// The app is already installed for this scope; this is that install.
    AlreadyInstalled { install_id: String },
    /// Install requests are not taken: share the app's link with someone who holds `AppManage`.
    InstallRequestsNotOffered,
    /// None of the artifact's locations answered with it.
    ArtifactUnreachable,
}
