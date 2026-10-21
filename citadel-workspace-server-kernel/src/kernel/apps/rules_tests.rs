//! The capability-to-permission map and granting at install. Each refusal sits beside the same
//! request made by someone who holds what it takes. What a call may do later is `effective_tests`.

use super::rules::*;
use super::test_facts::{caps, holds, perms};
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_manifest::CapabilityRequest;
use citadel_workspace_types::roles::owner_permissions;
use citadel_workspace_types::structs::Permission;
use std::collections::HashSet;

fn request(cap: Capability, optional: bool) -> CapabilityRequest {
    CapabilityRequest {
        cap,
        why: "because".into(),
        optional,
        hosts: None,
        routes: None,
        targets: None,
    }
}

#[test]
fn every_app_install_allow_permission_is_what_some_capability_needs() {
    let needed: HashSet<Permission> = Capability::ALL
        .into_iter()
        .map(required_installer_permission)
        .collect();
    let allow: Vec<Permission> = Permission::ALL_VARIANTS
        .into_iter()
        .filter(|p| format!("{p:?}").starts_with("AppInstallAllow"))
        .collect();
    assert_eq!(allow.len(), 14);
    for p in allow {
        assert!(needed.contains(&p), "{p:?} gates no capability");
    }
    assert!(needed.contains(&Permission::AppInstall));
    assert_eq!(
        needed.len(),
        15,
        "the 14 grants and AppInstall, nothing else"
    );
}

#[test]
fn the_network_capabilities_each_need_their_own_permission() {
    assert_eq!(
        required_installer_permission(Capability::NetHost),
        Permission::AppInstallAllowHostNetwork
    );
    assert_eq!(
        required_installer_permission(Capability::NetHostPrivate),
        Permission::AppInstallAllowPrivateNetwork
    );
    assert_eq!(
        required_installer_permission(Capability::NetServer),
        Permission::AppInstallAllowServerNetwork
    );
    assert_eq!(
        required_installer_permission(Capability::IhttpServe),
        Permission::AppInstallAllowInternalServe
    );
    assert_eq!(
        required_installer_permission(Capability::IhttpCall),
        Permission::AppInstallAllowInternalCall
    );
}

#[test]
fn an_installer_without_the_network_grant_cannot_grant_network() {
    let requests = [
        request(Capability::Canvas, false),
        request(Capability::NetServer, true),
    ];
    let member = holds(perms(&[
        Permission::AppInstall,
        Permission::AppInstallAllowHostNetwork,
    ]));
    let refused = check_grant(
        &requests,
        &caps(&[Capability::Canvas, Capability::NetServer]),
        &member,
        false,
    );
    assert_eq!(
        refused,
        Err(AppsRefusal::CapabilityNotGrantable(Capability::NetServer))
    );
    // Control: the same grant by someone holding the server-network permission.
    let admin = holds(perms(&[
        Permission::AppInstall,
        Permission::AppInstallAllowServerNetwork,
    ]));
    assert_eq!(
        check_grant(
            &requests,
            &caps(&[Capability::Canvas, Capability::NetServer]),
            &admin,
            false
        ),
        Ok(())
    );
    // And leaving the optional capability out needs no network permission at all.
    assert_eq!(
        check_grant(&requests, &caps(&[Capability::Canvas]), &member, false),
        Ok(())
    );
}

#[test]
fn a_grant_is_what_the_manifest_asks_with_every_required_capability() {
    let requests = [
        request(Capability::Canvas, false),
        request(Capability::NodesRead, true),
    ];
    let owner = holds(owner_permissions());
    let unasked = check_grant(
        &requests,
        &caps(&[Capability::Canvas, Capability::ChatSend]),
        &owner,
        false,
    );
    assert_eq!(
        unasked,
        Err(AppsRefusal::NotRequested(Capability::ChatSend))
    );
    let left_out = check_grant(&requests, &caps(&[Capability::NodesRead]), &owner, false);
    assert_eq!(
        left_out,
        Err(AppsRefusal::RequiredCapabilityLeftOut(Capability::Canvas))
    );
    assert_eq!(
        check_grant(
            &requests,
            &caps(&[Capability::Canvas, Capability::NodesRead]),
            &owner,
            false
        ),
        Ok(())
    );
}

#[test]
fn documents_go_to_the_first_party_key_only_and_private_needs_host_network() {
    let owner = holds(owner_permissions());
    let docs = [request(Capability::Documents, false)];
    assert_eq!(
        check_grant(&docs, &caps(&[Capability::Documents]), &owner, false),
        Err(AppsRefusal::FirstPartyOnly(Capability::Documents))
    );
    assert_eq!(
        check_grant(&docs, &caps(&[Capability::Documents]), &owner, true),
        Ok(())
    );
    let net = [
        request(Capability::NetHost, true),
        request(Capability::NetHostPrivate, true),
    ];
    assert_eq!(
        check_grant(&net, &caps(&[Capability::NetHostPrivate]), &owner, false),
        Err(AppsRefusal::RequiredCapabilityLeftOut(Capability::NetHost))
    );
    assert_eq!(
        check_grant(
            &net,
            &caps(&[Capability::NetHost, Capability::NetHostPrivate]),
            &owner,
            false
        ),
        Ok(())
    );
}

#[test]
fn an_owner_may_grant_everything_and_a_member_seed_only_the_intrinsic_capabilities() {
    let owner = holds(owner_permissions());
    assert!(Capability::ALL
        .into_iter()
        .all(|c| owner(required_installer_permission(c))));
    let member_seed = citadel_workspace_types::roles::seed_roles()
        .into_iter()
        .find(|r| r.id == citadel_workspace_types::roles::MEMBER_ROLE_ID)
        .map(|r| r.permissions)
        .unwrap_or_default();
    let member = holds(member_seed);
    let grantable: Vec<Capability> = Capability::ALL
        .into_iter()
        .filter(|c| member(required_installer_permission(*c)))
        .collect();
    assert_eq!(
        grantable,
        [
            Capability::Canvas,
            Capability::Ui,
            Capability::Events,
            Capability::Navigate,
            Capability::Log,
            Capability::Documents
        ]
    );
}
