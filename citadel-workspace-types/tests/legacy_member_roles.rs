//! Member records and requests from before the role table must still load, and load as the
//! role they meant.

use citadel_workspace_types::roles::{ADMIN_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID};
use citadel_workspace_types::roles_legacy::LegacyRoleRead;
use citadel_workspace_types::roles_protocol::MemberRole;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::WORKSPACE_ROOT_ID;

/// A record as the old role write left it: the enum, and the role's set copied into the root.
fn stored(role: &str, root_permissions: &str) -> User {
    let json = format!(
        r#"{{"id":"alice","name":"Alice","role":{role},
            "permissions":{{"{WORKSPACE_ROOT_ID}":{root_permissions},"room-1":["EditMdx"]}},
            "metadata":{{}}}}"#
    );
    serde_json::from_str(&json).expect("a record without workspace_roles must load")
}

#[test]
fn an_old_admin_record_reads_as_the_admin_role() {
    let mut user = stored(r#""Admin""#, r#"["All"]"#);
    assert!(user.workspace_roles.is_empty());

    assert_eq!(
        user.read_legacy_role(),
        LegacyRoleRead::Mapped {
            role_id: ADMIN_ROLE_ID
        }
    );
    assert_eq!(user.role_id_in(WORKSPACE_ROOT_ID), Some(ADMIN_ROLE_ID));
}

/// The copy is what would outlive an edit to the role: a direct grant is honoured first.
#[test]
fn the_copied_role_set_is_removed_and_real_grants_are_kept() {
    let mut user = stored(r#""Member""#, r#"["ViewContent","SendMessages","EditMdx"]"#);
    user.read_legacy_role();

    let root = user
        .permissions
        .get(WORKSPACE_ROOT_ID)
        .expect("EditMdx was granted on top of the role, so the key stays");
    assert_eq!(root.len(), 1, "the role's own permissions were left behind");
    assert!(root.contains(&Permission::EditMdx));
    assert!(
        user.permissions.contains_key("room-1"),
        "a per-node grant was touched"
    );
}

#[test]
fn a_root_key_holding_only_the_copy_is_dropped() {
    let mut user = stored(r#""Admin""#, r#"["All"]"#);
    user.read_legacy_role();
    assert!(!user.permissions.contains_key(WORKSPACE_ROOT_ID));
}

#[test]
fn a_custom_role_becomes_member_and_says_so() {
    let mut user = stored(r#"{"Custom":["editor",16]}"#, r#"["EditMdx","AddUsers"]"#);
    assert_eq!(
        user.read_legacy_role(),
        LegacyRoleRead::CustomBecameMember {
            name: "editor".to_string()
        }
    );
    assert_eq!(user.role_id_in(WORKSPACE_ROOT_ID), Some(MEMBER_ROLE_ID));
    assert!(
        !user.permissions.contains_key(WORKSPACE_ROOT_ID),
        "the rank-16 copy outlived the mapping, keeping AddUsers"
    );
}

#[test]
fn a_banned_record_holds_no_role() {
    let mut user = stored(r#""Banned""#, "[]");
    assert_eq!(user.read_legacy_role(), LegacyRoleRead::Current);
    assert_eq!(user.role_id_in(WORKSPACE_ROOT_ID), None);
}

#[test]
fn reading_twice_changes_nothing_more() {
    let mut user = stored(r#""Owner""#, r#"["EditMdx"]"#);
    user.read_legacy_role();
    let once = user.clone();
    assert_eq!(user.read_legacy_role(), LegacyRoleRead::Current);
    assert_eq!(user.workspace_roles, once.workspace_roles);
    assert_eq!(user.permissions, once.permissions);
    assert_eq!(user.role_id_in(WORKSPACE_ROOT_ID), Some(OWNER_ROLE_ID));
}

#[test]
fn a_current_record_keeps_its_role_id() {
    let mut user = User::new("bob".into(), "Bob".into(), UserRole::Admin);
    user.workspace_roles
        .insert(WORKSPACE_ROOT_ID.to_string(), "role-editors".to_string());
    assert_eq!(user.read_legacy_role(), LegacyRoleRead::Current);
    assert_eq!(user.role_id_in(WORKSPACE_ROOT_ID), Some("role-editors"));
}

#[test]
fn both_spellings_of_a_role_decode() {
    let decode = |json: &str| serde_json::from_str::<MemberRole>(json).expect(json);
    assert_eq!(decode(r#""Admin""#), MemberRole::Legacy(UserRole::Admin));
    assert_eq!(decode(r#""Banned""#), MemberRole::Legacy(UserRole::Banned));
    assert_eq!(
        decode(r#"{"Custom":["x",3]}"#),
        MemberRole::Legacy(UserRole::Custom("x".into(), 3))
    );
    assert_eq!(decode(r#""admin""#), MemberRole::Id("admin".into()));
    assert_eq!(decode(r#""role-1f2e""#), MemberRole::Id("role-1f2e".into()));
}
