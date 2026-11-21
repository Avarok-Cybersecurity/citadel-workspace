//! The role model is a hierarchy, and nothing asserted that it actually was one.
//!
//! `Permission::for_role` built each role's set by hand, and the Owner arm had
//! drifted: it granted EditContent and the management permissions but not
//! ViewContent, SendMessages, ReadMessages, UploadFiles, DownloadFiles or
//! EditMdx. A Member promoted to Owner in the admin UI therefore lost the
//! ability to read the workspace and chat in it, and still could not edit a
//! document. These tests state the hierarchy that was always intended.

use citadel_workspace_types::roles::{
    WorkspaceRoles, ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID,
};
use citadel_workspace_types::structs::{Permission, User};
use std::collections::HashSet;

/// The built-ins as a fresh workspace's table holds them.
fn perms(role_id: &str) -> HashSet<Permission> {
    WorkspaceRoles::seeded()
        .get(role_id)
        .unwrap_or_else(|| panic!("the seeded table has no {role_id} role"))
        .permissions
        .clone()
}

#[test]
fn all_variants_is_complete_and_unique() {
    let unique: HashSet<Permission> = Permission::ALL_VARIANTS.into_iter().collect();
    assert_eq!(
        unique.len(),
        Permission::ALL_VARIANTS.len(),
        "ALL_VARIANTS contains a duplicate"
    );
}

#[test]
fn owner_is_a_superset_of_member() {
    let owner = perms(OWNER_ROLE_ID);
    for permission in perms(MEMBER_ROLE_ID) {
        assert!(
            owner.contains(&permission),
            "Owner is missing {permission:?}, which a plain Member holds — \
             promoting a member to owner would take capability away"
        );
    }
}

#[test]
fn member_is_a_superset_of_guest() {
    let member = perms(MEMBER_ROLE_ID);
    for permission in perms(GUEST_ROLE_ID) {
        assert!(
            member.contains(&permission),
            "Member is missing {permission:?}"
        );
    }
}

#[test]
fn owner_can_run_the_workspace() {
    let owner = perms(OWNER_ROLE_ID);
    // The document editor gates on EditMdx; without it the owner of a workspace
    // cannot edit anything in it.
    for permission in [
        Permission::EditMdx,
        Permission::EditContent,
        Permission::ViewContent,
        Permission::SendMessages,
        Permission::Themes,
        Permission::CreateNode,
    ] {
        assert!(
            owner.contains(&permission),
            "Owner should hold {permission:?}"
        );
    }
}

#[test]
fn owner_stops_short_of_admin() {
    let owner = perms(OWNER_ROLE_ID);
    assert!(
        !owner.contains(&Permission::All),
        "the All wildcard belongs to Admin alone"
    );
    assert!(
        !owner.contains(&Permission::ConfigureSystem),
        "ConfigureSystem is server-level, not workspace-level"
    );
}

#[test]
fn admin_holds_the_wildcard() {
    assert!(perms(ADMIN_ROLE_ID).contains(&Permission::All));
}

#[test]
fn a_banned_account_holds_no_role_anywhere() {
    let root = citadel_workspace_types::WORKSPACE_ROOT_ID;
    let mut user = User::new("bo".into(), "Bo".into());
    user.workspace_roles
        .insert(root.to_string(), ADMIN_ROLE_ID.to_string());
    assert_eq!(user.role_id_in(root), Some(ADMIN_ROLE_ID));
    user.banned = true;
    assert_eq!(
        user.role_id_in(root),
        None,
        "a ban is outranked by a stale role id"
    );
}
