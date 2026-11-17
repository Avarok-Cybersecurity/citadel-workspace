//! The apps every workspace is provisioned with (Calendar design §3.2), pure: whether a release the
//! server was built with may be installed for the whole workspace, and with what.
//!
//! A provisioned release must be on the glue ABI (its module is in the UI bundle, so the server
//! carries only the signed manifest), which `verify_listing_with` accepts only under one of the
//! `trusted` first-party keys, and support the `workspace` scope. It is granted what it requires; an optional capability is left for an admin to grant,
//! as at any install.

use super::install::{grant_details, verify_listing_with};
use super::rules::check_grant;
use citadel_workspace_types::apps::{Capability, ScopeKind};
use citadel_workspace_types::apps_install::{AppsRefusal, GrantDetails};
use citadel_workspace_types::apps_manifest::{AppManifest, ABI_FIRST_PARTY_GLUE};
use std::collections::BTreeSet;

/// A signed release: the exact manifest bytes and the `app.mldsa.sig` text.
#[derive(Debug, Clone, Copy)]
pub struct SignedBundle<'a> {
    pub manifest: &'a [u8],
    pub signature: &'a str,
}

/// What provisioning installs a release with.
#[derive(Debug)]
pub struct ProvisionPlan {
    pub manifest: AppManifest,
    pub granted: BTreeSet<Capability>,
    pub details: GrantDetails,
}

/// Whether `bundle` may be provisioned, with `trusted` as the first-party keys.
pub fn plan_provisioning(
    bundle: &SignedBundle<'_>,
    trusted: &[&str],
) -> Result<ProvisionPlan, AppsRefusal> {
    let manifest = verify_listing_with(bundle.manifest, bundle.signature, trusted)?;
    if manifest.sdk.abi != ABI_FIRST_PARTY_GLUE {
        return Err(AppsRefusal::InvalidManifest(
            "a provisioned app is a glue app: the server carries no module".to_string(),
        ));
    }
    if !manifest.scopes.contains(&ScopeKind::Workspace) {
        return Err(AppsRefusal::ScopeNotSupported);
    }
    let granted: BTreeSet<Capability> = manifest
        .capabilities
        .iter()
        .filter(|r| !r.optional)
        .map(|r| r.cap)
        .collect();
    check_grant(&manifest.capabilities, &granted, &|_| true, true)?;
    Ok(ProvisionPlan {
        details: grant_details(&manifest, &granted),
        granted,
        manifest,
    })
}
