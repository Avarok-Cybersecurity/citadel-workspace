//! The apps every workspace is provisioned with (Calendar design §3.2), pure: what provisioning
//! does with a release the server was built with.
//!
//! A glue-ABI release (its module is in the UI bundle, so the server carries only the signed
//! manifest), which `verify_listing_with` accepts only under one of the `trusted` first-party
//! keys, and which supports the `workspace` scope, is installed for the whole workspace. It is
//! granted what it requires; an optional capability is left for an admin to grant, as at any
//! install.
//!
//! A release on an app ABI, signed by one of the `trusted` keys, is listed and not installed: the
//! server carries its module (`SignedBundle::module`, checked against the manifest's artifact),
//! stores it, and an admin installs the app where they choose, consenting to what it asks, as for
//! any listing.

use super::artifact::check_artifact_bytes;
use super::install::{grant_details, is_first_party_in, stores_module, verify_listing_with};
use super::rules::{check_grant, provisioning_holds};
use citadel_workspace_types::apps::{Capability, ScopeKind};
use citadel_workspace_types::apps_install::{AppsRefusal, GrantDetails};
use citadel_workspace_types::apps_manifest::AppManifest;
use std::collections::BTreeSet;

/// A signed release: the exact manifest bytes, the `app.mldsa.sig` text and, for a release whose
/// module the server stores (`install::stores_module`), that module. A glue release has none:
/// its module is in the UI bundle.
#[derive(Debug, Clone, Copy)]
pub struct SignedBundle<'a> {
    pub manifest: &'a [u8],
    pub signature: &'a str,
    pub module: Option<&'a [u8]>,
}

/// What provisioning installs a release with.
#[derive(Debug)]
pub struct ProvisionPlan {
    pub manifest: AppManifest,
    pub granted: BTreeSet<Capability>,
    pub details: GrantDetails,
}

/// What provisioning does with a release.
#[derive(Debug)]
pub enum Provisioning<'a> {
    /// A glue release: installed for the whole workspace.
    Install(ProvisionPlan),
    /// A release on an app ABI: listed, with `module` (checked against its manifest) stored.
    List {
        manifest: AppManifest,
        module: &'a [u8],
    },
}

impl Provisioning<'_> {
    pub fn manifest(&self) -> &AppManifest {
        match self {
            Self::Install(plan) => &plan.manifest,
            Self::List { manifest, .. } => manifest,
        }
    }
}

/// What may be done with `bundle`, with `trusted` as the first-party keys.
pub fn plan_provisioning<'a>(
    bundle: &SignedBundle<'a>,
    trusted: &[&str],
) -> Result<Provisioning<'a>, AppsRefusal> {
    let manifest = verify_listing_with(bundle.manifest, bundle.signature, trusted)?;
    if stores_module(&manifest) {
        return plan_listing(manifest, bundle.module, trusted);
    }
    if bundle.module.is_some() {
        return Err(AppsRefusal::InvalidManifest(
            "a glue release's module is in the UI bundle: the server carries none".to_string(),
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
    check_grant(&manifest.capabilities, &granted, &provisioning_holds, true)?;
    Ok(Provisioning::Install(ProvisionPlan {
        details: grant_details(&manifest, &granted),
        granted,
        manifest,
    }))
}

/// A verified app-ABI release: listed when a first-party key signed it and `module` is the one
/// its manifest names.
fn plan_listing<'a>(
    manifest: AppManifest,
    module: Option<&'a [u8]>,
    trusted: &[&str],
) -> Result<Provisioning<'a>, AppsRefusal> {
    if !is_first_party_in(trusted, &manifest.publisher.mldsa65_public_key) {
        return Err(AppsRefusal::InvalidManifest(
            "a provisioned release is signed by a first-party key".to_string(),
        ));
    }
    let module = module.ok_or(AppsRefusal::ArtifactUnreachable)?;
    check_artifact_bytes(&manifest.artifact, module)?;
    Ok(Provisioning::List { manifest, module })
}
