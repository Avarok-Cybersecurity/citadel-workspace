use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Editing a document requires EditMdx, not the right to restructure the workspace
///
/// `update_node` required `EditTreeStructure` at `WORKSPACE_ROOT_ID` for EVERY
/// update — so saving a document, which changes no structure at all, was refused
/// unless the user could restructure the entire workspace.
///
/// That is not a permission any custom role receives: `Permission::for_role`
/// never inserts `EditTreeStructure` for `Custom`, while `EditMdx` is directly
/// grantable in the permission matrix and is exactly what the UI gates its Edit
/// button on. So an admin could grant precisely the persona "can edit MDX
/// documents", the Edit button would correctly enable, and every save was
/// refused — invisibly, because writes reported success on send.
///
/// These drive the request layer as a NON-admin, because `check_entity_permission`
/// short-circuits for admins and would make every assertion below vacuous.
async fn office_with_editor<R: citadel_sdk::prelude::Ratchet>(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<R>,
    user: &str,
    permissions: Vec<Permission>,
) -> String {
    let created = execute_command(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Engineering".to_string(),
            description: "where the work happens".to_string(),
        },
    )
    .await
    .expect("CreateNode dispatch failed");

    let WorkspaceProtocolResponse::Node(office) = created else {
        panic!("expected Node, got {created:?}");
    };

    execute_command(
        kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: user.to_string(),
            domain_id: Some(office.id.clone()),
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await
    .expect("AddMember dispatch failed");

    execute_command(
        kernel,
        WorkspaceProtocolRequest::UpdateMemberPermissions {
            user_id: user.to_string(),
            domain_id: office.id.clone(),
            permissions,
            operation: UpdateOperation::Set,
        },
    )
    .await
    .expect("UpdateMemberPermissions dispatch failed");

    office.id
}

#[tokio::test]
async fn a_user_granted_edit_mdx_can_save_a_document() {
    let kernel = create_test_kernel().await;
    let editor = "mdx_editor";
    let office = office_with_editor(&kernel, editor, vec![Permission::EditMdx]).await;

    let saved = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateNode {
            node_id: office.clone(),
            name: None,
            description: None,
            mdx_content: Some("# My notes".to_string()),
            rules: None,
            chat_enabled: None,
            is_default: None,
        },
        editor,
    )
    .await
    .expect("UpdateNode dispatch failed");

    assert!(
        !matches!(saved, WorkspaceProtocolResponse::Error(_)),
        "a user granted EditMdx cannot save a document: {saved:?}"
    );
}

#[tokio::test]
async fn edit_mdx_does_not_confer_the_right_to_rename() {
    let kernel = create_test_kernel().await;
    let editor = "mdx_editor_2";
    let office = office_with_editor(&kernel, editor, vec![Permission::EditMdx]).await;

    let renamed = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateNode {
            node_id: office.clone(),
            name: Some("Renamed".to_string()),
            description: None,
            mdx_content: None,
            rules: None,
            chat_enabled: None,
            is_default: None,
        },
        editor,
    )
    .await
    .expect("UpdateNode dispatch failed");

    // Loosening the content gate must not loosen the structural one.
    assert!(
        matches!(renamed, WorkspaceProtocolResponse::Error(_)),
        "EditMdx alone must not permit renaming a node: {renamed:?}"
    );
}

#[tokio::test]
async fn a_user_with_neither_permission_cannot_save() {
    let kernel = create_test_kernel().await;
    let outsider = "no_perms_user";
    let office = office_with_editor(&kernel, outsider, vec![Permission::ViewContent]).await;

    let saved = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateNode {
            node_id: office,
            name: None,
            description: None,
            mdx_content: Some("# Not mine to write".to_string()),
            rules: None,
            chat_enabled: None,
            is_default: None,
        },
        outsider,
    )
    .await
    .expect("UpdateNode dispatch failed");

    assert!(
        matches!(saved, WorkspaceProtocolResponse::Error(_)),
        "a user with only ViewContent must not be able to save: {saved:?}"
    );
}
