//! Terms a member accepts, and the consent state built on them.
//!
//! Avarok's platform terms are one versioned constant here (SSOT): the server checks
//! acceptance against it and serves its text, so the UI never carries a copy. A workspace's
//! own terms are written by its admin and versioned by the server on every change.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Bump with every change to `PLATFORM_TERMS_TEXT`; members re-accept on their next sign-in.
pub const PLATFORM_TERMS_VERSION: u32 = 2;
/// Avarok's platform terms.
pub const PLATFORM_TERMS_TEXT: &str = include_str!("platform_terms.md");
/// Bump with every change to `CUSTOMER_TERMS_TEXT`; creating a workspace requires the current one.
/// The control plane carries this number (deploy/tenant-worker/control/customer-terms.mjs) and
/// scripts/check-customer-terms-version-parity.mjs fails the build if the two differ.
pub const CUSTOMER_TERMS_VERSION: u32 = 2;
/// The terms whoever creates a workspace accepts for it.
pub const CUSTOMER_TERMS_TEXT: &str = include_str!("customer_terms.md");
/// Longest workspace terms an admin may set, in characters.
pub const MAX_WORKSPACE_TERMS_CHARS: usize = 20_000;

/// One version of a terms text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TermsDocument {
    pub version: u32,
    pub text: String,
}

/// The terms a member must have accepted now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CurrentTerms {
    pub platform: TermsDocument,
    /// `None` when the workspace has no terms of its own.
    pub workspace: Option<TermsDocument>,
}

impl CurrentTerms {
    /// Whether a member who accepted these versions has accepted these terms.
    pub fn accepted_by(&self, platform: Option<u32>, workspace: Option<u32>) -> bool {
        platform == Some(self.platform.version)
            && self
                .workspace
                .as_ref()
                .is_none_or(|terms| workspace == Some(terms.version))
    }
}

/// The caller's own consent, and what the server requires now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MyConsent {
    pub accepted_platform_version: Option<u32>,
    pub accepted_workspace_version: Option<u32>,
    pub required_platform_version: u32,
    pub required_workspace_version: Option<u32>,
    /// The accepted versions are the required ones.
    pub terms_current: bool,
    /// The user's opt-in, as stored.
    pub telemetry_enabled: bool,
    /// `telemetry_enabled && terms_current`: whether an upload would be stored.
    pub uploads_allowed: bool,
}
