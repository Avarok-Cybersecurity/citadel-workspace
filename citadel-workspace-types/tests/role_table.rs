//! The role table a workspace starts with, and how it is read back.

use citadel_workspace_types::roles::{
    is_valid_role_color, seed_roles, RoleDefinition, WorkspaceRoles, ADMIN_ROLE_ID, GUEST_ROLE_ID,
    MEMBER_ROLE_ID, OWNER_POSITION, OWNER_ROLE_ID,
};
use citadel_workspace_types::structs::Permission;
use std::collections::HashSet;

fn set(permissions: &[Permission]) -> HashSet<Permission> {
    permissions.iter().copied().collect()
}

/// The fixed sets as `Permission::for_role` granted them before roles were editable, written
/// out by name rather than derived, so a change to a seed cannot also change what it is
/// compared with. The one addition is `ManageRoles`, which did not exist: the Owner holds every
/// permission but `All` and `ConfigureSystem`, so it holds the new one too.
#[test]
fn the_seeds_are_the_roles_every_workspace_had() {
    use Permission::*;
    let owner = set(&[
        CreateNode,
        DeleteNode,
        UpdateNode,
        CreateWorkspace,
        UpdateWorkspace,
        DeleteWorkspace,
        EditContent,
        AddUsers,
        RemoveUsers,
        EditMdx,
        EditNodeConfig,
        AddNode,
        UpdateNodeSettings,
        ViewContent,
        ViewMembers,
        ManageNodeMembers,
        SendMessages,
        ReadMessages,
        UploadFiles,
        DownloadFiles,
        ManageDomains,
        EditWorkspaceConfig,
        BanUser,
        EditTreeStructure,
        ManageNodeTypes,
        Themes,
        ViewTelemetry,
        ManageRoles,
    ]);
    let expected = [
        (OWNER_ROLE_ID, owner),
        (ADMIN_ROLE_ID, set(&[All])),
        (
            MEMBER_ROLE_ID,
            set(&[
                ViewContent,
                ViewMembers,
                SendMessages,
                ReadMessages,
                UploadFiles,
                DownloadFiles,
            ]),
        ),
        (GUEST_ROLE_ID, set(&[ViewContent, ViewMembers])),
    ];

    let table = WorkspaceRoles::seeded();
    assert_eq!(table.roles.len(), expected.len(), "an unexpected seed role");
    for (id, permissions) in expected {
        let role = table.get(id).unwrap_or_else(|| panic!("no {id} seed"));
        assert_eq!(role.permissions, permissions, "the {id} seed changed");
    }
}

#[test]
fn the_seeds_rank_owner_admin_member_guest() {
    let ids: Vec<String> = WorkspaceRoles::seeded()
        .roles
        .into_iter()
        .map(|role| role.id)
        .collect();
    assert_eq!(
        ids,
        [OWNER_ROLE_ID, ADMIN_ROLE_ID, MEMBER_ROLE_ID, GUEST_ROLE_ID]
    );
}

fn role(id: &str, position: u16, permissions: &[Permission]) -> RoleDefinition {
    RoleDefinition {
        id: id.to_string(),
        name: id.to_string(),
        permissions: set(permissions),
        position,
        color: None,
    }
}

/// The Owner is defined in code. A stored table cannot weaken it, rename it, or seat a second
/// role at its position.
#[test]
fn a_stored_table_cannot_replace_the_owner() {
    let stored = WorkspaceRoles {
        roles: vec![
            role(OWNER_ROLE_ID, 5, &[]),
            role("usurper", OWNER_POSITION, &[Permission::ViewContent]),
            role("editor", 250, &[Permission::EditMdx]),
        ],
    };
    let table = stored.normalized();

    let owner = table.get(OWNER_ROLE_ID).expect("the owner is always there");
    assert_eq!(owner.position, OWNER_POSITION);
    assert!(owner.grants(Permission::ManageRoles));
    assert!(
        table.get("usurper").is_none(),
        "a role took the Owner's position"
    );
    assert_eq!(
        table.roles[0].id, OWNER_ROLE_ID,
        "the Owner is listed first"
    );
    assert_eq!(
        table.roles.iter().filter(|r| r.is_owner()).count(),
        1,
        "two Owner roles"
    );
    assert!(
        table.get("editor").is_some(),
        "an ordinary role was dropped"
    );
}

#[test]
fn the_owner_is_never_stored() {
    assert!(WorkspaceRoles::seeded()
        .editable()
        .iter()
        .all(|role| !role.is_owner()));
}

#[test]
fn only_hex_colours_are_accepted() {
    assert!(is_valid_role_color("#a1B2c3"));
    for bad in [
        "", "a1b2c3", "#a1b2c", "#a1b2c3d", "#zzzzzz", "red", "#fff;}",
    ] {
        assert!(!is_valid_role_color(bad), "{bad:?} was accepted");
    }
}

/// `scripts/check-permission-parity.mjs` compares the UI's labels and categories against the
/// seeds without parsing Rust; it reads this file, which this test writes the way ts-rs writes
/// the bindings beside it, and which the bindings gate keeps committed and current.
#[test]
fn the_seed_table_is_exported_for_the_parity_check() {
    let seeds: Vec<serde_json::Value> = seed_roles()
        .into_iter()
        .map(|role| {
            let permissions: Vec<String> = Permission::ALL_VARIANTS
                .into_iter()
                .filter(|p| role.permissions.contains(p))
                .map(|p| format!("{p:?}"))
                .collect();
            serde_json::json!({
                "id": role.id,
                "name": role.name,
                "position": role.position,
                "permissions": permissions,
            })
        })
        .collect();
    let mut text = serde_json::to_string_pretty(&seeds).expect("serialise");
    text.push('\n');
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("bindings/seed_roles.json");
    std::fs::write(&path, text).expect("write bindings/seed_roles.json");
}
