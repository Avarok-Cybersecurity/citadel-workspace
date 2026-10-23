//! An app's `manifest.json`: strict, every field required unless it says otherwise.
//!
//! The exact published bytes are what the publisher signs (`citadel-app-signature`), what the
//! kernel stores and what the consent screen shows, so the manifest is read once, refused on any
//! unknown or duplicate field, and validated field by field (`apps_manifest_check`) before
//! anything is done with it.

use crate::apps::{AppAudience, Capability, ScopeKind};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use crate::apps_manifest_check::ManifestRefusal;

/// The only manifest format there is.
pub const MANIFEST_FORMAT: u32 = 1;
/// The largest manifest read at all, before parsing.
pub const MAX_MANIFEST_BYTES: usize = 192 * 1024;
/// The app ABI: a core wasm module importing only from `citadel_app_abi_1`.
pub const ABI_V1: &str = "citadel-app-abi-1";
/// The transitional wasm-bindgen ABI, accepted only under the first-party publisher key.
pub const ABI_FIRST_PARTY_GLUE: &str = "wasm-bindgen-glue-firstparty";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct AppManifest {
    /// Always `MANIFEST_FORMAT`.
    pub format: u32,
    /// Reverse-DNS (`citadel-app-id`).
    pub id: String,
    /// `MAJOR.MINOR.PATCH`, strictly increasing per id.
    pub version: String,
    pub sdk: SdkRequirement,
    pub publisher: Publisher,
    pub name: String,
    /// Plain text, one line.
    pub summary: String,
    /// Plain text; `\n` is the only control character.
    pub description: String,
    pub icon: AppIcon,
    pub categories: Vec<AppCategory>,
    pub audience: AppAudience,
    /// Where the app paints. Empty for a background app.
    pub surfaces: Vec<AppSurface>,
    /// Which kinds of install scope the app supports.
    pub scopes: Vec<ScopeKind>,
    pub capabilities: Vec<CapabilityRequest>,
    pub limits: AppLimits,
    pub artifact: ArtifactRef,
    /// Optional and informational: earlier versions, each lower than `version`.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_versions: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct SdkRequirement {
    /// `ABI_V1`, or `ABI_FIRST_PARTY_GLUE` under the first-party key.
    pub abi: String,
    /// The lowest SDK version the app runs on.
    pub min: String,
    /// The highest: a version, or `N.x` for any version with major `N`.
    pub max: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct Publisher {
    pub name: String,
    /// The ML-DSA-65 verifying key, 3904 lowercase hex characters.
    pub mldsa65_public_key: String,
    /// An https URL.
    pub contact: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct AppIcon {
    /// A PNG, standard base64 with padding.
    pub png_base64: String,
    /// The decoded PNG's size limit, at most `MAX_ICON_BYTES`. A u64 because the client decodes
    /// `max_bytes` as a bigint wherever it appears (it is one in the storage limits).
    pub max_bytes: u64,
}

/// The catalogue's closed list of categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AppCategory {
    Planning,
    Productivity,
    Communication,
    Documents,
    Files,
    Developer,
    Design,
    Data,
    Integrations,
    Utilities,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AppSurface {
    /// A document's editor region.
    CanvasPane,
    /// A zone inside a document (`<AppZone app=.. />`).
    MdZone,
}

/// One capability the app asks for, and why. `hosts` is present exactly for `net.host` and
/// `net.server`, `routes` for `ihttp.serve`, `targets` for `ihttp.call`; any other combination
/// is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct CapabilityRequest {
    pub cap: Capability,
    /// Shown on the consent screen, plain text.
    pub why: String,
    /// Whether the installer may leave it out.
    pub optional: bool,
    /// Explicit hosts (`host` or `host:port`), no wildcards, at most eight.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hosts: Option<Vec<String>>,
    /// `METHOD /path` patterns; a segment may be `:name`, the last may be `*`.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routes: Option<Vec<String>>,
    /// Other apps' ids the app may call; its own is implied.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub targets: Option<Vec<String>>,
}

/// What the app asks the host for; each is clamped by host policy whatever it says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct AppLimits {
    /// 64 KiB wasm pages, at most `MAX_MEMORY_PAGES`.
    pub memory_pages: u32,
    pub max_call_rate_per_s: u32,
    pub frame_budget_ms: u32,
    pub storage_user_bytes: u32,
    pub storage_scope_bytes: u32,
    /// How long `app_close` and the replies it waits on may take before the host ends the
    /// instance, in milliseconds: 1 to `abi::MAX_CLOSE_GRACE_MS`. Required, never defaulted: the
    /// publisher states the cleanup it needs, the consent screen and the host hold it to that.
    pub close_grace_ms: u32,
}

/// The wasm module: its identity is the digest; locations are hints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRef {
    /// 64 lowercase hex characters.
    pub sha256: String,
    pub bytes: u32,
    pub locations: Vec<ArtifactLocation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArtifactLocation {
    Https {
        url: String,
    },
    /// A file at a pinned commit of a GitHub repository.
    GithubPinned {
        /// `owner/name`.
        repo: String,
        /// 40 lowercase hex characters.
        commit: String,
        path: String,
    },
}
