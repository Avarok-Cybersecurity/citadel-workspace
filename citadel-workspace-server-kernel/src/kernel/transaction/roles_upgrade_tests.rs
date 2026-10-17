//! A role table stored before secure links existed, read by the kernel: its roles that can view
//! the workspace share links now, so a custom role made then can assign Member again; the Guest
//! does not; and an administrator taking the permission away afterwards is not undone.
//!
//! The legacy record is written as raw JSON, as an old server wrote it, which only a test inside
//! the crate can do.

use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
use crate::kernel::secure_links::test_support::kernel_with_member;
use crate::WORKSPACE_ROOT_ID;
use citadel_workspace_types::roles::{GUEST_ROLE_ID, MEMBER_ROLE_ID};
use citadel_workspace_types::roles_protocol::MemberRole;
use citadel_workspace_types::structs::{Permission, User, UserRole};

const EDITOR: &str = "role-editor";

/// The table as a server before secure links stored it: no `version`, and nobody shares links.
fn legacy_table() -> serde_json::Value {
    let role = |id: &str, position: u16, permissions: &[&str]| serde_json::json!({ "id": id, "name": id, "permissions": permissions, "position": position, "color": null });
    serde_json::json!({
        "roles": [
            role("admin", 300, &["All"]),
            role(EDITOR, 250, &["ViewContent", "ViewMembers", "ReadMessages", "EditContent", "SendMessages",
                "UploadFiles", "DownloadFiles", "AddUsers", "RemoveUsers", "EditMdx", "ManageRoles"]),
            role(MEMBER_ROLE_ID, 200, &["ViewContent", "ViewMembers", "SendMessages", "ReadMessages",
                "UploadFiles", "DownloadFiles"]),
            role(GUEST_ROLE_ID, 100, &["ViewContent", "ViewMembers"]),
        ],
        "default_role_id": MEMBER_ROLE_ID,
    })
}

#[tokio::test]
async fn a_table_from_before_secure_links_is_upgraded_once() {
    let kernel = kernel_with_member("climber").await;
    let ops = &kernel.domain_operations;
    let backend = &ops.backend_tx_manager;
    backend
        .backend_save("citadel_workspace.roles.workspace-root", &legacy_table())
        .await
        .expect("legacy table");
    // The climber holds the editor role, as a member added under the old table would.
    let climber = User {
        workspace_roles: std::iter::once((WORKSPACE_ROOT_ID.to_string(), EDITOR.to_string()))
            .collect(),
        ..backend.get_user("climber").await.unwrap().expect("climber")
    };
    backend
        .insert_user("climber".to_string(), climber)
        .await
        .unwrap();
    let newcomer = User::new(
        "newcomer".to_string(),
        "newcomer".to_string(),
        UserRole::Member,
    );
    backend
        .insert_user("newcomer".to_string(), newcomer)
        .await
        .unwrap();

    let table = backend.get_roles(WORKSPACE_ROOT_ID).await.unwrap();
    let shares = |id: &str| {
        table
            .get(id)
            .expect(id)
            .grants(Permission::ShareSecureLinks)
    };
    assert!(
        shares(EDITOR) && shares(MEMBER_ROLE_ID),
        "roles that view the workspace share"
    );
    assert!(!shares(GUEST_ROLE_ID), "the Guest does not");

    let added = ops
        .add_user_to_domain(
            "climber",
            "newcomer",
            WORKSPACE_ROOT_ID,
            MemberRole::Id(MEMBER_ROLE_ID.to_string()),
        )
        .await;
    assert!(
        added.is_ok(),
        "the editor may assign Member again: {added:?}"
    );

    // An administrator takes it away from the editor; it stays away across reloads.
    let mut edited = backend.get_roles(WORKSPACE_ROOT_ID).await.unwrap();
    for role in edited.roles.iter_mut().filter(|r| r.id == EDITOR) {
        role.permissions.remove(&Permission::ShareSecureLinks);
    }
    {
        let _guard = backend.lock_workspaces().await;
        backend
            .save_roles(WORKSPACE_ROOT_ID, &edited)
            .await
            .unwrap();
    }
    for _ in 0..2 {
        let reread = backend.get_roles(WORKSPACE_ROOT_ID).await.unwrap();
        assert!(
            !reread
                .get(EDITOR)
                .unwrap()
                .grants(Permission::ShareSecureLinks),
            "not re-granted"
        );
        assert!(reread
            .get(MEMBER_ROLE_ID)
            .unwrap()
            .grants(Permission::ShareSecureLinks));
    }
}
