//! What an update does to an install: take the new release under the same grant, or wait for
//! consent. An update never grows what an install may do on its own: a new required capability,
//! a new host, route or target, or a different publisher key all wait for someone to consent,
//! and the installed version keeps running meanwhile. Pure.

use super::install::grant_details;
use citadel_app_id::AppVersion;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, ConsentReason, GrantDetails};
use citadel_workspace_types::apps_manifest::AppManifest;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateOutcome {
    /// Take the new release with this grant: the old one, less what the new one no longer asks.
    Apply {
        granted: BTreeSet<Capability>,
        details: GrantDetails,
    },
    NeedsConsent(ConsentReason),
}

/// Whether `candidate` is newer than what `install` runs; equal and lower are refused.
pub fn require_newer(install: &AppInstall, candidate: &AppManifest) -> Result<(), AppsRefusal> {
    let (Ok(have), Ok(offered)) = (
        AppVersion::parse(&install.version),
        AppVersion::parse(&candidate.version),
    ) else {
        return Err(AppsRefusal::VersionNotNewer);
    };
    if candidate.id != install.app_id {
        return Err(AppsRefusal::Unavailable);
    }
    if offered > have {
        Ok(())
    } else {
        Err(AppsRefusal::VersionNotNewer)
    }
}

pub fn decide_update(install: &AppInstall, candidate: &AppManifest) -> UpdateOutcome {
    if candidate.publisher.mldsa65_public_key != install.pinned_publisher_key {
        return UpdateOutcome::NeedsConsent(ConsentReason::PublisherKeyChanged);
    }
    let asked: BTreeSet<Capability> = candidate.capabilities.iter().map(|r| r.cap).collect();
    let newly_required = candidate
        .capabilities
        .iter()
        .any(|r| !r.optional && !install.granted.contains(&r.cap));
    let granted: BTreeSet<Capability> = install.granted.intersection(&asked).copied().collect();
    let details = grant_details(candidate, &granted);
    if newly_required || !details_within(&details, &install.details) {
        return UpdateOutcome::NeedsConsent(ConsentReason::CapabilitiesGrew);
    }
    UpdateOutcome::Apply { granted, details }
}

/// Every host, route and target in `new` was already in `old`.
fn details_within(new: &GrantDetails, old: &GrantDetails) -> bool {
    let within = |new: &[String], old: &[String]| new.iter().all(|entry| old.contains(entry));
    within(&new.host_network_hosts, &old.host_network_hosts)
        && within(&new.server_network_hosts, &old.server_network_hosts)
        && within(&new.ihttp_routes, &old.ihttp_routes)
        && within(&new.ihttp_call_targets, &old.ihttp_call_targets)
}
