//! The role new members are given: part of the role table. A stored default naming no role a
//! member can hold falls back to `roles_stored::fallback_default_role`; a table from an earlier
//! server is refused.

use citadel_workspace_types::roles::{
    seed_roles, RoleDefinition, WorkspaceRoles, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID,
};
use citadel_workspace_types::roles_stored::{DefaultRoleRead, StoredRoles, ROLE_TABLE_VERSION};
use citadel_workspace_types::structs::{User, UserRole};

fn seed(id: &str) -> RoleDefinition {
    seed_roles()
        .into_iter()
        .find(|role| role.id == id)
        .unwrap_or_else(|| panic!("no seed {id}"))
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
    let (read, how) = StoredRoles::of(&table).into_table().unwrap();
    assert_eq!(how, DefaultRoleRead::Stored);
    assert_eq!(read, table, "a stored table did not round-trip");
}

/// Tables written by an earlier server: without the default, or at another format version.
#[test]
fn a_table_from_an_earlier_server_is_refused() {
    let without_default = serde_json::json!({ "roles": [seed(MEMBER_ROLE_ID)], "version": 2 });
    assert!(serde_json::from_value::<StoredRoles>(without_default).is_err());
    let without_version = serde_json::json!({ "roles": [], "default_role_id": MEMBER_ROLE_ID });
    assert!(serde_json::from_value::<StoredRoles>(without_version).is_err());
    for version in [0, 1, ROLE_TABLE_VERSION + 1] {
        let stored = StoredRoles {
            roles: vec![seed(MEMBER_ROLE_ID)],
            default_role_id: MEMBER_ROLE_ID.to_string(),
            version,
        };
        let err = stored.into_table().expect_err("another version is refused");
        assert!(err.contains("written by another server"), "{err}");
    }
}

#[test]
fn a_stored_table_naming_no_role_but_the_owner_gets_member_back() {
    let stored = StoredRoles {
        roles: vec![],
        default_role_id: "role-gone".to_string(),
        version: ROLE_TABLE_VERSION,
    };
    let (table, _) = stored.into_table().unwrap();
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
            default_role_id: named.to_string(),
            version: ROLE_TABLE_VERSION,
        };
        let (table, how) = stored.into_table().unwrap();
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
