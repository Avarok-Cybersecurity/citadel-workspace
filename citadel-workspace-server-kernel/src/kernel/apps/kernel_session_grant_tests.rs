//! `HostNetGrant` carries `citadel.session`: the servers the running release's manifest names
//! and its `limits.session`, exactly while the capability is effective for the asking member,
//! under the same gates as the hosts (the install's grant, the installer still holding
//! `AppInstallAllowHostNetwork`, the member's own switch).

use super::kernel_host_net_grant_tests::{grant_for, set_installer_holds};
use super::test_manifests::*;
use super::test_support::{ask, Kernel};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::HostNetGrant;
use citadel_workspace_types::apps_manifest_session::SessionLimits;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;
use serde_json::json;

const SERVER: &str = "synchronized.work";
const HOST: &str = "api.acme.example";

/// The kanban app asking, optionally, for a session to `SERVER` and `net.host` over `HOST`.
fn session_spec() -> Spec {
    let mut spec = Spec::new("1.0.0");
    spec.capabilities = json!([
        { "cap": "canvas", "why": "Draws", "optional": false },
        { "cap": "citadel.session", "why": "Live", "optional": true, "servers": [SERVER] },
        { "cap": "net.host", "why": "Fallback", "optional": true, "hosts": [HOST] },
    ]);
    spec.limits["session"] = json!({ "max_msg_bytes": 4096, "max_msgs_per_s": 8 });
    spec
}

/// A workspace where `inst`, holding `AppInstallAllowHostNetwork`, installed the app for the
/// workspace with `granted` besides `canvas`. Answers the kernel and the install id.
async fn installed_with(granted: &[Capability]) -> (Kernel, String) {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), session_spec());
    let kernel = workspace_serving(bytes.clone()).await;
    set_installer_holds(&kernel, Permission::AppInstallAllowHostNetwork, true).await;
    let caps: Vec<Capability> = [Capability::Canvas]
        .iter()
        .chain(granted)
        .copied()
        .collect();
    let offer = signed(&spec, &key, &bytes);
    let request = install_request(&spec, &key, offer, InstallScope::Workspace, &caps, false);
    let AppsResponse::Installed { install } = ask(&kernel, "inst", request).await else {
        panic!("not installed")
    };
    (kernel, install.id)
}

fn session_only() -> Option<HostNetGrant> {
    Some(HostNetGrant {
        app_id: "com.acme.kanban".to_string(),
        hosts: Vec::new(),
        private: false,
        servers: vec![SERVER.to_string()],
        session: Some(SessionLimits {
            max_msg_bytes: 4096,
            max_msgs_per_s: 8,
        }),
    })
}

#[tokio::test]
async fn an_install_granted_a_session_answers_its_servers_and_limits() {
    let (kernel, id) = installed_with(&[Capability::CitadelSession]).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, session_only());
}

#[tokio::test]
async fn an_install_granted_no_session_answers_no_server() {
    let (kernel, id) = installed_with(&[Capability::NetHost]).await;
    let grant = grant_for(&kernel, "alice", &id).await.expect("net.host");
    assert_eq!(grant.hosts, [HOST]);
    assert!(grant.servers.is_empty(), "{grant:?}");
    assert_eq!(grant.session, None);

    let (kernel, id) = installed_with(&[]).await;
    assert_eq!(
        grant_for(&kernel, "alice", &id).await,
        None,
        "nothing to reach"
    );
}

#[tokio::test]
async fn both_answer_side_by_side() {
    let (kernel, id) = installed_with(&[Capability::CitadelSession, Capability::NetHost]).await;
    let grant = grant_for(&kernel, "alice", &id).await.expect("a grant");
    assert_eq!(
        (grant.hosts.as_slice(), grant.servers.as_slice()),
        (&[HOST.to_string()][..], &[SERVER.to_string()][..])
    );
    assert!(grant.session.is_some());
}

#[tokio::test]
async fn the_servers_follow_the_installers_role_at_the_time_of_the_question() {
    let (kernel, id) = installed_with(&[Capability::CitadelSession]).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, session_only());
    set_installer_holds(&kernel, Permission::AppInstallAllowHostNetwork, false).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, None);
    set_installer_holds(&kernel, Permission::AppInstallAllowHostNetwork, true).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, session_only());
}

#[tokio::test]
async fn a_member_who_turned_the_install_off_is_granted_no_server() {
    let (kernel, id) = installed_with(&[Capability::CitadelSession]).await;
    let off = AppsRequest::SetDisabledForMe {
        install_id: id.clone(),
        disabled: true,
    };
    assert!(matches!(
        ask(&kernel, "alice", off).await,
        AppsResponse::DisabledForMe { disabled: true, .. }
    ));
    assert_eq!(grant_for(&kernel, "alice", &id).await, None);
    assert_eq!(grant_for(&kernel, "bob", &id).await, session_only());
}
