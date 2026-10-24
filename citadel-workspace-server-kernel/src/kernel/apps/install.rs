//! Whether a signed listing is one the server accepts, and whether an installer may install it
//! where and with what they asked. Pure: the handler gathers the snapshots and facts.

use super::audience::scope_reach_within_audience;
use super::facts::{GatheredFacts, PermissionSnapshot};
use super::rules::{action_permissions, check_grant, may_install_at, AppsAction};
use citadel_app_signature::{sha256, sha256_from_hex, verify, ArtifactDigests};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppsRefusal, GrantDetails};
use citadel_workspace_types::apps_manifest::{
    AppManifest, CapabilityRequest, ABI_FIRST_PARTY_GLUE,
};
use citadel_workspace_types::structs::Permission;
use std::collections::BTreeSet;

/// The first-party publisher keys. None is provisioned yet (the Docs migration brings the
/// first), so no app may be granted `documents` or load through the transitional glue ABI.
pub const FIRST_PARTY_PUBLISHER_KEYS: &[&str] = &[];

pub fn is_first_party(publisher_key: &str) -> bool {
    FIRST_PARTY_PUBLISHER_KEYS.contains(&publisher_key)
}

/// The manifest in `manifest_bytes`, if it is valid, may use its ABI, and `signature` is its
/// publisher's over it and the artifact digest it names.
pub fn verify_listing(manifest_bytes: &[u8], signature: &str) -> Result<AppManifest, AppsRefusal> {
    let manifest = AppManifest::from_bytes(manifest_bytes)
        .map_err(|why| AppsRefusal::InvalidManifest(why.to_string()))?;
    let key = &manifest.publisher.mldsa65_public_key;
    if manifest.sdk.abi == ABI_FIRST_PARTY_GLUE && !is_first_party(key) {
        return Err(AppsRefusal::InvalidManifest(
            "the transitional glue ABI is for the first-party publisher only".to_string(),
        ));
    }
    let wasm = sha256_from_hex(&manifest.artifact.sha256).map_err(|_| AppsRefusal::BadSignature)?;
    let digests = ArtifactDigests {
        manifest: sha256(manifest_bytes),
        wasm,
    };
    verify(key, &manifest.id, &manifest.version, &digests, signature)
        .map_err(|_| AppsRefusal::BadSignature)?;
    Ok(manifest)
}

/// What an install request asks, with the facts about the installer.
pub struct InstallInput<'a> {
    pub installer: &'a str,
    pub manifest: &'a AppManifest,
    pub app_id: &'a str,
    pub version: &'a str,
    pub scope: &'a InstallScope,
    pub granted: &'a [Capability],
    pub pinned_publisher_key: &'a str,
    pub inject_requirement: bool,
    /// The installer's permissions on the workspace root.
    pub at_root: &'a PermissionSnapshot,
    /// ... and on the scope's node (`facts::authority_node`), the root for a scope with none.
    pub at_authority: &'a PermissionSnapshot,
    /// Whether the node a `Node` or `NodeTree` scope names exists.
    pub scope_node_exists: bool,
    pub facts: &'a GatheredFacts,
}

/// What an accepted install records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPlan {
    pub granted: BTreeSet<Capability>,
    pub details: GrantDetails,
    /// The node whose header the kernel writes the requirement into.
    pub inject_into: Option<String>,
}

pub fn decide_install(input: &InstallInput<'_>) -> Result<InstallPlan, AppsRefusal> {
    let manifest = input.manifest;
    if manifest.id != input.app_id || manifest.version != input.version {
        return Err(AppsRefusal::Unavailable);
    }
    let key = &manifest.publisher.mldsa65_public_key;
    if key != input.pinned_publisher_key {
        return Err(AppsRefusal::BadSignature);
    }
    let root = |p: Permission| input.at_root.holds(p);
    may_install_at(input.scope, &manifest.scopes, input.installer, &root)?;
    let node_scope = matches!(
        input.scope,
        InstallScope::Node(_) | InstallScope::NodeTree(_)
    );
    if node_scope && !input.scope_node_exists {
        return Err(AppsRefusal::Unavailable);
    }
    let for_others = input.scope != &InstallScope::SelfOnly(input.installer.to_string());
    if for_others && !input.at_authority.holds(Permission::UpdateNodeSettings) {
        return Err(AppsRefusal::PermissionRequired(
            Permission::UpdateNodeSettings,
        ));
    }
    let granted: BTreeSet<Capability> = input.granted.iter().copied().collect();
    let authority = |p: Permission| input.at_authority.holds(p);
    check_grant(
        &manifest.capabilities,
        &granted,
        &authority,
        is_first_party(key),
    )?;
    scope_reach_within_audience(
        input.scope,
        &manifest.audience,
        &input.facts.members,
        input.facts,
    )?;
    let inject_into = if input.inject_requirement {
        let (InstallScope::Node(node) | InstallScope::NodeTree(node)) = input.scope else {
            return Err(AppsRefusal::ScopeNotSupported);
        };
        if let Some(missing) = action_permissions(AppsAction::WriteMdHeader)
            .iter()
            .find(|p| !input.at_authority.holds(**p))
        {
            return Err(AppsRefusal::PermissionRequired(*missing));
        }
        Some(node.clone())
    } else {
        None
    };
    Ok(InstallPlan {
        details: grant_details(manifest, &granted),
        granted,
        inject_into,
    })
}

/// The hosts, routes and targets the manifest lists for the capabilities in `granted`.
pub fn grant_details(manifest: &AppManifest, granted: &BTreeSet<Capability>) -> GrantDetails {
    let listed = |cap: Capability, pick: fn(&CapabilityRequest) -> Option<Vec<String>>| {
        if !granted.contains(&cap) {
            return Vec::new();
        }
        manifest
            .capabilities
            .iter()
            .filter(|r| r.cap == cap)
            .find_map(pick)
            .unwrap_or_default()
    };
    GrantDetails {
        host_network_hosts: listed(Capability::NetHost, |r| r.hosts.clone()),
        server_network_hosts: listed(Capability::NetServer, |r| r.hosts.clone()),
        ihttp_routes: listed(Capability::IhttpServe, |r| r.routes.clone()),
        ihttp_call_targets: listed(Capability::IhttpCall, |r| r.targets.clone()),
        ihttp_p2p_routes: listed(Capability::IhttpP2pServe, |r| r.routes.clone()),
        topics: {
            let mut topics = listed(Capability::GroupTopicSubscribe, |r| r.topics.clone());
            for topic in listed(Capability::GroupTopicPublish, |r| r.topics.clone()) {
                if !topics.contains(&topic) {
                    topics.push(topic);
                }
            }
            topics
        },
    }
}
