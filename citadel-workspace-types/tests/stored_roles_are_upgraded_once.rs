//! A role table stored before secure links existed is upgraded once, when read: every role that
//! can view the workspace, bar the Guest, is given `ShareSecureLinks`. The table is then written
//! with the version it has, so the upgrade never runs again and an administrator's later removal
//! stands.

use citadel_workspace_types::roles::{
    RoleDefinition, WorkspaceRoles, ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID,
};
use citadel_workspace_types::roles_stored::{StoredRoles, ROLE_TABLE_VERSION};
use citadel_workspace_types::structs::Permission;

fn role(id: &str, position: u16, permissions: &[Permission]) -> RoleDefinition {
    RoleDefinition {
        id: id.to_string(),
        name: id.to_string(),
        permissions: permissions.iter().copied().collect(),
        position,
        color: None,
    }
}

/// As stored before the version field: the record JSON with no `version`.
fn stored_before_versions(roles: Vec<RoleDefinition>) -> StoredRoles {
    let json = serde_json::json!({ "roles": roles, "default_role_id": MEMBER_ROLE_ID });
    serde_json::from_value(json).expect("a table without a version loads")
}

fn shares(table: &WorkspaceRoles, id: &str) -> bool {
    table
        .get(id)
        .expect(id)
        .grants(Permission::ShareSecureLinks)
}

fn old_table() -> Vec<RoleDefinition> {
    use Permission::*;
    vec![
        role(ADMIN_ROLE_ID, 300, &[All]),
        role("role-editor", 250, &[ViewContent, AddUsers, ManageRoles]),
        role(MEMBER_ROLE_ID, 200, &[ViewContent, SendMessages]),
        role(GUEST_ROLE_ID, 100, &[ViewContent, ViewMembers]),
        role("role-blind", 50, &[SendMessages]),
    ]
}

#[test]
fn a_table_stored_before_the_upgrade_has_it_when_read() {
    let stored = stored_before_versions(old_table());
    assert_eq!(
        stored.version, 0,
        "a record without the field has had no upgrade"
    );
    let (table, _) = stored.into_table();
    for id in ["role-editor", MEMBER_ROLE_ID, ADMIN_ROLE_ID] {
        assert!(
            shares(&table, id),
            "{id} can view the workspace, so it shares"
        );
    }
    assert!(!shares(&table, GUEST_ROLE_ID), "the Guest stays read-only");
    assert!(
        !shares(&table, "role-blind"),
        "a role that cannot view the workspace is not given it"
    );
}

#[test]
fn it_is_written_as_upgraded_so_a_later_removal_stands() {
    let (mut table, _) = stored_before_versions(old_table()).into_table();
    let written = StoredRoles::of(&table);
    assert_eq!(written.version, ROLE_TABLE_VERSION);

    // An administrator takes it away again; the table is saved and read back.
    for role in table.roles.iter_mut().filter(|r| r.id == "role-editor") {
        role.permissions.remove(&Permission::ShareSecureLinks);
    }
    let json = serde_json::to_string(&StoredRoles::of(&table)).expect("serialises");
    let (reread, _) = serde_json::from_str::<StoredRoles>(&json)
        .expect("reads back")
        .into_table();
    assert!(
        !shares(&reread, "role-editor"),
        "the removal stands across a reload"
    );
    let (again, _) = serde_json::from_str::<StoredRoles>(&json)
        .expect("reads back")
        .into_table();
    assert_eq!(again, reread, "a second load changes nothing");
}
