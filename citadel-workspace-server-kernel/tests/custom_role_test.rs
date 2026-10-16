//! Editing the role table, rule by rule.
//!
//! `role_edits` is pure, so these drive it directly: no kernel, no storage, no mocks. Every
//! refusal has the permitted edit beside it, so a rule that refused everything would fail.

use citadel_workspace_server_kernel::kernel::role_edits::{create, delete, update, MAX_ROLES};
use citadel_workspace_types::roles::{
    RoleDefinition, WorkspaceRoles, ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_POSITION,
    OWNER_ROLE_ID,
};
use citadel_workspace_types::roles_protocol::RoleChange;
use citadel_workspace_types::structs::Permission;

fn table() -> WorkspaceRoles {
    WorkspaceRoles::seeded()
}

fn role(table: &WorkspaceRoles, id: &str) -> RoleDefinition {
    table.get(id).unwrap_or_else(|| panic!("no {id}")).clone()
}

fn owner() -> RoleDefinition {
    role(&table(), OWNER_ROLE_ID)
}

fn admin() -> RoleDefinition {
    role(&table(), ADMIN_ROLE_ID)
}

fn member() -> RoleDefinition {
    role(&table(), MEMBER_ROLE_ID)
}

fn scribe(table: &WorkspaceRoles, actor: &RoleDefinition) -> WorkspaceRoles {
    create(
        table,
        actor,
        "role-scribe".into(),
        "Scribe",
        &[Permission::ViewContent, Permission::EditMdx],
        150,
        Some("#336699".into()),
    )
    .expect("an Admin creates a role below them")
}

// ---------- create ----------

#[test]
fn a_created_role_takes_its_place_in_the_table() {
    let next = scribe(&table(), &admin());
    let created = role(&next, "role-scribe");
    assert_eq!(created.name, "Scribe");
    assert_eq!(created.position, 150);
    assert_eq!(created.color.as_deref(), Some("#336699"));
    let order: Vec<&str> = next.roles.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(
        order,
        [
            OWNER_ROLE_ID,
            ADMIN_ROLE_ID,
            MEMBER_ROLE_ID,
            "role-scribe",
            GUEST_ROLE_ID
        ],
        "the table is kept in position order"
    );
}

#[test]
fn nobody_creates_a_role_at_or_above_their_own() {
    for position in [300, 301, OWNER_POSITION] {
        assert!(
            create(
                &table(),
                &admin(),
                "role-x".into(),
                "X",
                &[],
                position,
                None
            )
            .is_err(),
            "an Admin created a role at {position}"
        );
    }
    assert!(create(&table(), &admin(), "role-x".into(), "X", &[], 299, None).is_ok());
}

#[test]
fn the_owner_creates_above_admin_but_never_at_its_own_position() {
    assert!(create(&table(), &owner(), "role-x".into(), "X", &[], 301, None).is_ok());
    assert!(create(
        &table(),
        &owner(),
        "role-x".into(),
        "X",
        &[],
        OWNER_POSITION,
        None
    )
    .is_err());
}

#[test]
fn a_role_holds_nothing_its_creator_lacks() {
    let lacking = create(
        &table(),
        &member(),
        "role-x".into(),
        "X",
        &[Permission::EditMdx],
        50,
        None,
    );
    assert!(lacking.is_err(), "a Member granted EditMdx: {lacking:?}");
    let held = create(
        &table(),
        &member(),
        "role-x".into(),
        "X",
        &[Permission::ViewContent],
        50,
        None,
    );
    assert!(held.is_ok(), "{held:?}");
}

#[test]
fn the_owner_cannot_grant_the_wildcard_it_does_not_hold() {
    let wildcard = create(
        &table(),
        &owner(),
        "role-x".into(),
        "X",
        &[Permission::All],
        10,
        None,
    );
    assert!(wildcard.is_err(), "{wildcard:?}");
    let config = create(
        &table(),
        &owner(),
        "role-x".into(),
        "X",
        &[Permission::ConfigureSystem],
        10,
        None,
    );
    assert!(config.is_err(), "{config:?}");
}

#[test]
fn positions_names_and_colours_are_checked() {
    let t = table();
    let a = admin();
    assert!(
        create(&t, &a, "role-x".into(), "X", &[], 200, None).is_err(),
        "position taken"
    );
    assert!(
        create(&t, &a, "role-x".into(), "member", &[], 250, None).is_err(),
        "name taken, any case"
    );
    assert!(
        create(&t, &a, "role-x".into(), "   ", &[], 250, None).is_err(),
        "blank name"
    );
    assert!(
        create(&t, &a, "role-x".into(), &"n".repeat(49), &[], 250, None).is_err(),
        "long name"
    );
    assert!(
        create(&t, &a, "role-x".into(), "X", &[], 250, Some("red".into())).is_err(),
        "colour"
    );
    assert!(
        create(&t, &a, ADMIN_ROLE_ID.into(), "X", &[], 250, None).is_err(),
        "id taken"
    );
    assert!(create(
        &t,
        &a,
        "role-x".into(),
        "X",
        &[],
        250,
        Some("#AbCdEf".into())
    )
    .is_ok());
}

#[test]
fn the_table_is_bounded() {
    let mut t = table();
    let mut position = 1;
    while t.roles.len() < MAX_ROLES {
        t = create(
            &t,
            &owner(),
            format!("role-{position}"),
            &format!("R{position}"),
            &[],
            position,
            None,
        )
        .expect("room left");
        position += 1;
    }
    assert!(create(&t, &owner(), "role-over".into(), "Over", &[], 999, None).is_err());
}

// ---------- update ----------

#[test]
fn a_role_is_renamed_recoloured_and_moved() {
    let t = scribe(&table(), &admin());
    let next = update(
        &t,
        &admin(),
        "role-scribe",
        &[
            RoleChange::Rename("Editor".into()),
            RoleChange::Recolor(None),
            RoleChange::Move(250),
        ],
    )
    .expect("an Admin edits a role below them");
    let edited = role(&next, "role-scribe");
    assert_eq!(
        (edited.name.as_str(), edited.color, edited.position),
        ("Editor", None, 250)
    );
}

#[test]
fn an_edit_is_all_or_nothing() {
    let t = scribe(&table(), &admin());
    let refused = update(
        &t,
        &admin(),
        "role-scribe",
        &[RoleChange::Rename("Editor".into()), RoleChange::Move(400)],
    );
    assert!(refused.is_err(), "moved above its editor: {refused:?}");
    assert_eq!(
        role(&t, "role-scribe").name,
        "Scribe",
        "the input was changed"
    );
}

#[test]
fn nobody_edits_a_role_at_or_above_their_own() {
    let rename = [RoleChange::Rename("Boss".into())];
    assert!(
        update(&table(), &admin(), ADMIN_ROLE_ID, &rename).is_err(),
        "their own role"
    );
    assert!(
        update(&table(), &member(), ADMIN_ROLE_ID, &rename).is_err(),
        "a role above"
    );
    assert!(update(&table(), &admin(), MEMBER_ROLE_ID, &rename).is_ok());
    assert!(
        update(&table(), &owner(), ADMIN_ROLE_ID, &rename).is_ok(),
        "the Owner edits Admin"
    );
}

#[test]
fn the_owner_role_is_fixed_even_for_the_owner() {
    for change in [
        RoleChange::Rename("Boss".into()),
        RoleChange::Revoke(vec![Permission::ManageRoles]),
        RoleChange::Move(5),
    ] {
        assert!(
            update(
                &table(),
                &owner(),
                OWNER_ROLE_ID,
                std::slice::from_ref(&change)
            )
            .is_err(),
            "{change:?} changed the Owner"
        );
    }
    assert!(delete(&table(), &owner(), OWNER_ROLE_ID, MEMBER_ROLE_ID).is_err());
}

#[test]
fn a_grant_is_contained_and_a_revoke_is_not() {
    let t = scribe(&table(), &admin());
    let actor = role(&t, MEMBER_ROLE_ID);
    // The scribe role sits at 150, below Member's 200, so a Member may edit it.
    assert!(
        update(
            &t,
            &actor,
            "role-scribe",
            &[RoleChange::Grant(vec![Permission::AddUsers])]
        )
        .is_err(),
        "a Member granted AddUsers"
    );
    let revoked = update(
        &t,
        &actor,
        "role-scribe",
        &[RoleChange::Revoke(vec![Permission::EditMdx])],
    )
    .expect("taking away grants nothing");
    assert!(!role(&revoked, "role-scribe").grants(Permission::EditMdx));
}

/// Admin holds the `All` wildcard. Unticking one permission must leave the rest, not leave the
/// wildcard standing (which would revoke nothing) or take everything.
#[test]
fn revoking_from_the_wildcard_spells_it_out() {
    let next = update(
        &table(),
        &owner(),
        ADMIN_ROLE_ID,
        &[RoleChange::Revoke(vec![Permission::EditMdx])],
    )
    .expect("the Owner edits Admin");
    let edited = role(&next, ADMIN_ROLE_ID);
    assert!(!edited.grants(Permission::EditMdx), "the wildcard survived");
    assert!(!edited.permissions.contains(&Permission::All));
    assert!(
        edited.grants(Permission::ManageRoles),
        "the rest went with it"
    );
    assert!(edited.grants(Permission::ConfigureSystem));
}

// ---------- delete ----------

#[test]
fn a_deleted_role_leaves_the_table() {
    let t = scribe(&table(), &admin());
    let next = delete(&t, &admin(), "role-scribe", GUEST_ROLE_ID).expect("deleted");
    assert!(next.get("role-scribe").is_none());
}

#[test]
fn the_holders_must_go_somewhere_the_actor_may_assign() {
    let t = scribe(&table(), &admin());
    assert!(
        delete(&t, &admin(), "role-scribe", "role-scribe").is_err(),
        "onto itself"
    );
    assert!(
        delete(&t, &admin(), "role-scribe", "role-nope").is_err(),
        "onto nothing"
    );
    assert!(
        delete(&t, &admin(), "role-scribe", ADMIN_ROLE_ID).is_err(),
        "onto their own position"
    );
    assert!(
        delete(&t, &admin(), "role-scribe", OWNER_ROLE_ID).is_err(),
        "onto the Owner"
    );
    assert!(
        delete(&t, &owner(), "role-scribe", ADMIN_ROLE_ID).is_ok(),
        "the Owner may"
    );
}

#[test]
fn nobody_deletes_a_role_at_or_above_their_own() {
    assert!(delete(&table(), &admin(), ADMIN_ROLE_ID, MEMBER_ROLE_ID).is_err());
    assert!(delete(&table(), &member(), ADMIN_ROLE_ID, GUEST_ROLE_ID).is_err());
    assert!(delete(&table(), &admin(), MEMBER_ROLE_ID, GUEST_ROLE_ID).is_ok());
}
