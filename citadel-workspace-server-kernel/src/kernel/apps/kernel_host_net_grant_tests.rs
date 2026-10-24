//! `HostNetGrant`: what the kernel tells a member's agent an install may reach from the member's
//! machine follows the install's grant, its installer's role now, the install's reach and the
//! member's own switch, and every refusal is the same `None`.

use super::test_manifests::*;
use super::test_runtime::{ask_on, install as install_with};
use super::test_support::{ask, Kernel};
use crate::WORKSPACE_ROOT_ID;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{HostNetGrant, InstallState};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;
use serde_json::json;

const HOSTS: [&str; 2] = ["api.acme.example", "printer.acme.example"];

/// The kanban app asking for `net.host` over `HOSTS`, and `net.host.private`.
fn host_net_spec() -> Spec {
    Spec {
        capabilities: json!([
            { "cap": "canvas", "why": "Draws", "optional": false },
            { "cap": "net.host", "why": "Syncs", "optional": true, "hosts": HOSTS },
            { "cap": "net.host.private", "why": "Prints", "optional": true },
        ]),
        ..Spec::new("1.0.0")
    }
}

/// `installer`'s role gains (`on`) or loses `permission`.
async fn set_installer_holds(kernel: &Kernel, permission: Permission, on: bool) {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut roles = backend.get_roles(WORKSPACE_ROOT_ID).await.unwrap();
    for role in roles.roles.iter_mut().filter(|r| r.id == "installer") {
        if on {
            role.permissions.insert(permission);
        } else {
            role.permissions.remove(&permission);
        }
    }
    backend.save_roles(WORKSPACE_ROOT_ID, &roles).await.unwrap();
}

/// A workspace where `inst` installed the app at `scope` with both network capabilities, its
/// role holding both permissions. Answers the kernel and the install id.
async fn installed_at(scope: InstallScope) -> (Kernel, String) {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), host_net_spec());
    let kernel = workspace_serving(bytes.clone()).await;
    set_installer_holds(&kernel, Permission::AppInstallAllowHostNetwork, true).await;
    set_installer_holds(&kernel, Permission::AppInstallAllowPrivateNetwork, true).await;
    let caps = [
        Capability::Canvas,
        Capability::NetHost,
        Capability::NetHostPrivate,
    ];
    let request = install_request(
        &spec,
        &key,
        signed(&spec, &key, &bytes),
        scope,
        &caps,
        false,
    );
    let AppsResponse::Installed { install } = ask(&kernel, "inst", request).await else {
        panic!("not installed")
    };
    (kernel, install.id)
}

/// The grant the kernel answers `user` about `install_id`, its tag and id checked.
async fn grant_for(kernel: &Kernel, user: &str, install_id: &str) -> Option<HostNetGrant> {
    let tag = 7;
    let request = AppsRequest::HostNetGrant {
        install_id: install_id.to_string(),
        tag,
    };
    match ask_on(kernel, user, Some(42), request).await {
        AppsResponse::HostNetGrant {
            install_id: answered,
            tag: echoed,
            grant,
        } if answered == install_id && echoed == tag => grant,
        other => panic!("not this question's answer: {other:?}"),
    }
}

fn full(private: bool) -> Option<HostNetGrant> {
    Some(HostNetGrant {
        app_id: "com.acme.kanban".to_string(),
        hosts: HOSTS.map(str::to_string).to_vec(),
        private,
    })
}

#[tokio::test]
async fn the_grant_follows_the_installers_role_at_the_time_of_the_question() {
    let (kernel, id) = installed_at(InstallScope::Workspace).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, full(true));

    set_installer_holds(&kernel, Permission::AppInstallAllowPrivateNetwork, false).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, full(false));

    set_installer_holds(&kernel, Permission::AppInstallAllowHostNetwork, false).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, None);
}

#[tokio::test]
async fn an_install_the_member_turned_off_reaches_nothing_until_turned_on() {
    let (kernel, id) = installed_at(InstallScope::Workspace).await;
    let set = |disabled: bool| AppsRequest::SetDisabledForMe {
        install_id: id.clone(),
        disabled,
    };
    assert!(matches!(
        ask(&kernel, "alice", set(true)).await,
        AppsResponse::DisabledForMe { disabled: true, .. }
    ));
    assert_eq!(grant_for(&kernel, "alice", &id).await, None);
    assert_eq!(grant_for(&kernel, "bob", &id).await, full(true));

    ask(&kernel, "alice", set(false)).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, full(true));
}

#[tokio::test]
async fn an_unknown_install_and_one_that_does_not_reach_the_member_get_the_same_none() {
    let (kernel, id) = installed_at(InstallScope::SelfOnly("inst".to_string())).await;
    assert_eq!(grant_for(&kernel, "inst", &id).await, full(true));
    assert_eq!(grant_for(&kernel, "alice", &id).await, None);
    assert_eq!(grant_for(&kernel, "alice", "no-such-install").await, None);
}

#[tokio::test]
async fn a_suspended_install_reaches_nothing() {
    let (kernel, id) = installed_at(InstallScope::Workspace).await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut install = backend.app_install(&id).await.unwrap().unwrap();
    install.state = InstallState::Suspended {
        reason: "abuse".to_string(),
    };
    backend.save_app_install(&install).await.unwrap();
    assert_eq!(grant_for(&kernel, "alice", &id).await, None);
}

#[tokio::test]
async fn an_install_granted_no_host_network_reaches_nothing() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install_with(&kernel, "inst", InstallScope::Workspace, &[]).await;
    assert_eq!(grant_for(&kernel, "alice", &id).await, None);
}

#[tokio::test]
async fn the_answer_carries_the_agents_tag_back() {
    let (kernel, id) = installed_at(InstallScope::Workspace).await;
    for tag in [0, 1, u64::MAX] {
        let request = AppsRequest::HostNetGrant {
            install_id: id.clone(),
            tag,
        };
        let answer = ask_on(&kernel, "alice", Some(42), request).await;
        assert!(
            matches!(answer, AppsResponse::HostNetGrant { tag: t, .. } if t == tag),
            "{answer:?}"
        );
    }
}
