//! The kernel's answer about an install of synchronized.work, read as the agent reads it: the
//! kernel's own decision (`kernel::apps::host_net`) over the committed manifest, framed as the
//! kernel frames it, through `WorkspaceHostNetAuthority::classify`.
//!
//! The agent's open decision (`kernel/apps/session/rules.rs` `decide_open`) is crate-private to
//! citadel-internal-service, so this stops at the `KernelGrant` it is handed: it refuses
//! `Ungranted` unless `session` is present and the requested server is one of `servers`, which
//! is what these assert. Without a network: the in-process run is the agent repository's
//! `an_app_session_reconnects_under_its_cid.rs`.

use super::*;
use citadel_workspace_server_kernel::kernel::apps::host_net::host_net_grant;
use citadel_workspace_server_kernel::kernel::apps::install::grant_details;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppInstall, InstallState, ListingSource};
use citadel_workspace_types::apps_manifest::AppManifest;
use std::collections::BTreeSet;

const APP: &str = "work.synchronized.app";

fn committed_manifest() -> AppManifest {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../apps/first-party/synchronized-work/manifest.json"
    );
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    AppManifest::from_bytes(&bytes).expect("the committed manifest")
}

/// What the agent is handed for an install granted `granted`, effective as granted.
fn agent_grant(granted: &[Capability]) -> Option<KernelGrant> {
    let manifest = committed_manifest();
    let granted: BTreeSet<Capability> = granted.iter().copied().collect();
    let install = AppInstall {
        id: "inst-sw".into(),
        app_id: manifest.id.clone(),
        version: manifest.version.clone(),
        manifest_sha256: "00".repeat(32),
        artifact_sha256: manifest.artifact.sha256.clone(),
        pinned_publisher_key: manifest.publisher.mldsa65_public_key.clone(),
        scope: InstallScope::Node("office".into()),
        details: grant_details(&manifest, &granted),
        granted: granted.clone(),
        installed_by: "boss".into(),
        installed_at_ms: 0,
        state: InstallState::Active,
        previous: None,
        injected_header_into: Vec::new(),
        source: ListingSource::FirstParty,
    };
    let grant = host_net_grant(&install, &manifest, &granted, false);
    let frame = super::response(AppsResponse::HostNetGrant {
        install_id: install.id.clone(),
        tag: 3,
        grant,
    });
    match WorkspaceHostNetAuthority.classify(&frame) {
        AuthoritySignal::Grant { tag: 3, grant, .. } => grant,
        other => panic!("not the answer: {other:?}"),
    }
}

#[test]
fn a_session_to_the_server_the_manifest_named_is_granted_and_no_other() {
    let grant = agent_grant(&[Capability::Canvas, Capability::CitadelSession])
        .expect("citadel.session is granted");
    assert_eq!(grant.app_id, APP);
    assert_eq!(
        grant.session,
        Some(SessionLimits {
            max_msg_bytes: 65536,
            max_msgs_per_s: 8,
        }),
        "the manifest's limits.session: without it the agent refuses every open"
    );
    assert!(grant.servers.iter().any(|s| s == "synchronized.work"));
    assert_eq!(grant.servers, ["synchronized.work"], "and no other server");
    assert!(grant.hosts.is_empty(), "net.host was not granted");
}

#[test]
fn without_citadel_session_the_agent_is_granted_no_server() {
    let grant = agent_grant(&[Capability::Canvas, Capability::NetHost]).expect("net.host");
    assert_eq!(grant.hosts, ["synchronized.work"]);
    assert!(grant.servers.is_empty(), "{grant:?}");
    assert_eq!(grant.session, None);
    assert_eq!(agent_grant(&[Capability::Canvas]), None, "nothing to reach");
}
