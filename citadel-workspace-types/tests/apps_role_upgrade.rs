//! Role table version 2: a table stored before apps existed gives `AppInstall` (installing an app
//! for oneself) to every role that can view the workspace, bar the Guest, and nothing else. A
//! table already at version 2 is read as it is, so an administrator's removal stands.

use citadel_workspace_types::roles::{
    RoleDefinition, WorkspaceRoles, ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID,
};
use citadel_workspace_types::roles_stored::{StoredRoles, ROLE_TABLE_VERSION};
use citadel_workspace_types::structs::Permission;
use std::collections::HashSet;

fn role(id: &str, position: u16, permissions: &[Permission]) -> RoleDefinition {
    RoleDefinition {
        id: id.to_string(),
        name: id.to_string(),
        permissions: permissions.iter().copied().collect(),
        position,
        color: None,
    }
}

/// As a version-1 server stored it: secure links already given, apps not yet existing.
fn stored_at(version: u32, roles: Vec<RoleDefinition>) -> StoredRoles {
    let json = serde_json::json!({ "roles": roles, "default_role_id": MEMBER_ROLE_ID, "version": version });
    serde_json::from_value(json).expect("a stored table loads")
}

fn v1_table() -> Vec<RoleDefinition> {
    use Permission::*;
    vec![
        role(ADMIN_ROLE_ID, 300, &[All]),
        role(
            "role-editor",
            250,
            &[ViewContent, ManageRoles, ShareSecureLinks],
        ),
        role(
            MEMBER_ROLE_ID,
            200,
            &[ViewContent, SendMessages, ShareSecureLinks],
        ),
        role(GUEST_ROLE_ID, 100, &[ViewContent, ViewMembers]),
        role("role-blind", 50, &[SendMessages]),
    ]
}

fn held(table: &WorkspaceRoles, id: &str) -> HashSet<Permission> {
    table.get(id).expect(id).permissions.clone()
}

#[test]
fn the_current_version_is_two() {
    assert_eq!(ROLE_TABLE_VERSION, 2);
}

#[test]
fn a_version_one_table_gives_app_install_to_viewers_and_nothing_else() {
    let before: Vec<RoleDefinition> = v1_table();
    let (table, _) = stored_at(1, before.clone()).into_table();
    for id in ["role-editor", MEMBER_ROLE_ID] {
        let original = &before.iter().find(|r| r.id == id).unwrap().permissions;
        let mut expected = original.clone();
        expected.insert(Permission::AppInstall);
        assert_eq!(
            held(&table, id),
            expected,
            "{id}: AppInstall and nothing more"
        );
    }
    assert_eq!(
        held(&table, ADMIN_ROLE_ID),
        [Permission::All].into_iter().collect(),
        "a role holding All is left as it is"
    );
}

#[test]
fn the_guest_and_a_role_that_cannot_view_keep_nothing_new() {
    let (table, _) = stored_at(1, v1_table()).into_table();
    assert_eq!(
        held(&table, GUEST_ROLE_ID),
        [Permission::ViewContent, Permission::ViewMembers]
            .into_iter()
            .collect(),
        "the Guest stays read-only"
    );
    assert_eq!(
        held(&table, "role-blind"),
        [Permission::SendMessages].into_iter().collect()
    );
}

#[test]
fn no_upgrade_ever_grants_what_an_app_could_be_given() {
    let (table, _) = stored_at(0, v1_table()).into_table();
    for role in table
        .roles
        .iter()
        .filter(|r| !r.is_owner() && r.id != ADMIN_ROLE_ID)
    {
        for p in Permission::ALL_VARIANTS {
            let name = format!("{p:?}");
            if name.starts_with("App") && p != Permission::AppInstall {
                assert!(
                    !role.permissions.contains(&p),
                    "{} was given {name}",
                    role.id
                );
            }
        }
    }
}

#[test]
fn a_table_already_at_version_two_is_untouched() {
    // An administrator took AppInstall away from Member after the upgrade.
    let (table, _) = stored_at(2, v1_table()).into_table();
    assert!(!held(&table, MEMBER_ROLE_ID).contains(&Permission::AppInstall));
    assert!(!held(&table, "role-editor").contains(&Permission::AppInstall));
    // Control: the same roles one version older are upgraded.
    let (older, _) = stored_at(1, v1_table()).into_table();
    assert!(held(&older, MEMBER_ROLE_ID).contains(&Permission::AppInstall));
}

#[test]
fn an_upgraded_table_is_written_at_version_two_and_not_upgraded_again() {
    let (mut table, _) = stored_at(1, v1_table()).into_table();
    assert_eq!(StoredRoles::of(&table).version, 2);
    for role in table.roles.iter_mut().filter(|r| r.id == MEMBER_ROLE_ID) {
        role.permissions.remove(&Permission::AppInstall);
    }
    let json = serde_json::to_string(&StoredRoles::of(&table)).unwrap();
    let (reread, _) = serde_json::from_str::<StoredRoles>(&json)
        .unwrap()
        .into_table();
    assert!(
        !held(&reread, MEMBER_ROLE_ID).contains(&Permission::AppInstall),
        "the removal stands across a reload"
    );
}

#[test]
fn a_table_from_before_versions_has_both_upgrades() {
    use Permission::*;
    let (table, _) = stored_at(0, vec![role(MEMBER_ROLE_ID, 200, &[ViewContent])]).into_table();
    assert_eq!(
        held(&table, MEMBER_ROLE_ID),
        [ViewContent, ShareSecureLinks, AppInstall]
            .into_iter()
            .collect()
    );
}
