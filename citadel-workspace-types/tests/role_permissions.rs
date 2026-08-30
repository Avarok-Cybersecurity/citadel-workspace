//! The role model is a hierarchy, and nothing asserted that it actually was one.
//!
//! `Permission::for_role` built each role's set by hand, and the Owner arm had
//! drifted: it granted EditContent and the management permissions but not
//! ViewContent, SendMessages, ReadMessages, UploadFiles, DownloadFiles or
//! EditMdx. A Member promoted to Owner in the admin UI therefore lost the
//! ability to read the workspace and chat in it, and still could not edit a
//! document. These tests state the hierarchy that was always intended.

use citadel_workspace_types::structs::{Permission, UserRole};
use std::collections::HashSet;

fn perms(role: UserRole) -> HashSet<Permission> {
    Permission::for_role(&role)
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
    let owner = perms(UserRole::Owner);
    for permission in perms(UserRole::Member) {
        assert!(
            owner.contains(&permission),
            "Owner is missing {permission:?}, which a plain Member holds — \
             promoting a member to owner would take capability away"
        );
    }
}

#[test]
fn member_is_a_superset_of_guest() {
    let member = perms(UserRole::Member);
    for permission in perms(UserRole::Guest) {
        assert!(
            member.contains(&permission),
            "Member is missing {permission:?}"
        );
    }
}

#[test]
fn owner_can_run_the_workspace() {
    let owner = perms(UserRole::Owner);
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
    let owner = perms(UserRole::Owner);
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
    assert!(perms(UserRole::Admin).contains(&Permission::All));
}

#[test]
fn banned_holds_nothing() {
    assert!(perms(UserRole::Banned).is_empty());
}
