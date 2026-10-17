//! The role new members are given: part of the role table, and read back from tables stored
//! before it was.
//!
//! The legacy-load rule (`roles_stored::legacy_default_role`): Member when the table still has
//! it, otherwise the lowest role below the Owner; a table with no role but the Owner gets the
//! seeded Member back. Nothing else about a stored table is filled in.

use citadel_workspace_types::roles::{
    seed_roles, RoleDefinition, WorkspaceRoles, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID,
};
use citadel_workspace_types::roles_stored::{DefaultRoleRead, StoredRoles};
use citadel_workspace_types::structs::{Permission, User, UserRole};

fn seed(id: &str) -> RoleDefinition {
    seed_roles()
        .into_iter()
        .find(|role| role.id == id)
        .unwrap_or_else(|| panic!("no seed {id}"))
}

fn created(id: &str, position: u16) -> RoleDefinition {
    RoleDefinition {
        id: id.to_string(),
        name: id.to_string(),
        permissions: [Permission::ViewContent].into_iter().collect(),
        position,
        color: None,
    }
}

/// A table as it was stored before it named a default: the editable roles, no field.
fn legacy(roles: Vec<RoleDefinition>) -> StoredRoles {
    let json = serde_json::json!({ "roles": roles }).to_string();
    serde_json::from_str(&json).expect("a table without default_role_id must load")
}

#[test]
fn a_workspace_starts_by_giving_new_members_member() {
    let table = WorkspaceRoles::seeded();
    assert_eq!(table.default_role_id, MEMBER_ROLE_ID);
    assert_eq!(
        table.default_role().map(|r| r.id.as_str()),
        Some(MEMBER_ROLE_ID)
    );
}

#[test]
fn a_stored_default_is_read_back_as_written() {
    let mut table = WorkspaceRoles::seeded();
    table.default_role_id = GUEST_ROLE_ID.to_string();
    let (read, how) = StoredRoles::of(&table).into_table();
    assert_eq!(how, DefaultRoleRead::Stored);
    assert_eq!(read, table, "a stored table did not round-trip");
}

#[test]
fn a_legacy_table_with_member_gives_new_members_member() {
    let stored = legacy(vec![
        seed("guest"),
        created("role-scribe", 150),
        seed("member"),
    ]);
    let (table, how) = stored.into_table();
    assert_eq!(how, DefaultRoleRead::Legacy);
    assert_eq!(table.default_role_id, MEMBER_ROLE_ID);
}

#[test]
fn a_legacy_table_without_member_gives_its_lowest_role() {
    let stored = legacy(vec![
        created("role-scribe", 150),
        seed(GUEST_ROLE_ID),
        created("role-lead", 250),
    ]);
    let (table, how) = stored.into_table();
    assert_eq!(how, DefaultRoleRead::Legacy);
    assert_eq!(
        table.default_role_id, GUEST_ROLE_ID,
        "not the role with the least reach"
    );
    assert!(
        table.get(MEMBER_ROLE_ID).is_none(),
        "a deleted Member came back"
    );
}

#[test]
fn a_legacy_table_with_only_the_owner_gets_member_back_as_its_default() {
    let (table, how) = legacy(vec![]).into_table();
    assert_eq!(how, DefaultRoleRead::Legacy);
    assert_eq!(table.default_role_id, MEMBER_ROLE_ID);
    assert_eq!(table.get(MEMBER_ROLE_ID), Some(&seed(MEMBER_ROLE_ID)));
    assert_eq!(table.roles[0].id, OWNER_ROLE_ID, "the Owner is still first");
}

/// No edit writes this; a corrupted record must still not give new members the Owner, or a role
/// that does not exist.
#[test]
fn a_stored_default_naming_the_owner_or_nothing_is_not_trusted() {
    for named in [OWNER_ROLE_ID, "role-gone"] {
        let stored = StoredRoles {
            roles: vec![seed(MEMBER_ROLE_ID), seed(GUEST_ROLE_ID)],
            default_role_id: Some(named.to_string()),
        };
        let (table, how) = stored.into_table();
        assert_eq!(
            how,
            DefaultRoleRead::Dangling {
                named: named.to_string()
            }
        );
        assert_eq!(table.default_role_id, MEMBER_ROLE_ID, "for '{named}'");
    }
}

/// The creator of an additional workspace holds its Owner role and nothing in the root. Read as
/// a legacy root Member, they joined the root holding Member whatever the table's default was.
#[test]
fn a_record_naming_another_workspaces_role_is_not_a_legacy_member() {
    let root = citadel_workspace_types::WORKSPACE_ROOT_ID;
    let mut creator = User::new("cy".into(), "Cy".into(), UserRole::Member);
    creator
        .workspace_roles
        .insert("ws-other".to_string(), OWNER_ROLE_ID.to_string());
    creator.read_legacy_role();
    assert_eq!(creator.role_id_in(root), None, "given a root role on read");

    // The control: a record from before the table names nothing anywhere, and is mapped.
    let mut old = User::new("ola".into(), "Ola".into(), UserRole::Member);
    old.read_legacy_role();
    assert_eq!(old.role_id_in(root), Some(MEMBER_ROLE_ID));
}
