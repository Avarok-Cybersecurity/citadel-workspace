//! Every gate that asked for the Admin role now asks for a named permission.
//!
//! A role-name gate cannot follow an edited role table: an Admin whose role lost a permission
//! kept the gate, and a role an Admin created to carry one never reached it. Each gate here is
//! driven twice, by two members whose roles differ by exactly the permission the gate names:
//! the one holding it must be admitted, the one without it refused. A gate that admitted both,
//! or refused both, fails.
//!
//! SetMembersVisible, UpdateSignInSettings and GetIceServers are covered beside their other
//! tests (`an_admin_can_hide_a_nodes_roster`, `an_admin_can_require_a_human_check_to_sign_in`,
//! `relay_servers_are_for_members`).

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::roles::GUEST_ROLE_ID;
use citadel_workspace_types::roles_protocol::MemberRole;
use citadel_workspace_types::structs::{NodeEntityType, Permission, TreeSchema, UserRole};
use citadel_workspace_types::{
    GroupMessageType, UpdateOperation, WorkspaceProtocolRequest as Req,
    WorkspaceProtocolResponse as Res,
};
use common::member_test_utils::{
    insert_user_with_role, join_root, member_holding, seed_role, GateKernel as Kernel,
};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD, TEST_ADMIN_USER_ID};
use std::sync::Arc;

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

/// Enough to see the workspace and talk in it, and nothing administrative.
const BASE: &[Permission] = &[
    Permission::ViewContent,
    Permission::ViewMembers,
    Permission::ReadMessages,
    Permission::SendMessages,
];

/// `with` holds BASE and `permission`; `without` holds BASE. Both sit below Admin, so the test
/// admin can set the scene, and above Member, so ladder checks never decide the outcome.
async fn holder_and_lacker(permission: Permission) -> Arc<Kernel> {
    let kernel = create_test_kernel().await;
    let mut with: Vec<Permission> = BASE.to_vec();
    with.push(permission);
    seed_role(&kernel, "role-with", 250, &with).await;
    seed_role(&kernel, "role-without", 240, BASE).await;
    member_holding(&kernel, "with", "role-with").await;
    member_holding(&kernel, "without", "role-without").await;
    insert_user_with_role(&kernel, "someone", UserRole::Member).await;
    join_root(&kernel, "someone").await;
    kernel
}

async fn send(kernel: &Kernel, actor: &str, request: &Req) -> Res {
    process_command_with_user(kernel, request, actor)
        .await
        .expect("dispatch")
}

fn refused(response: &Res) -> bool {
    matches!(response, Res::Error(message) if message.contains("Permission denied"))
}

/// The gate refuses `without` and admits `with`; `admitted` says what admission looks like.
async fn gate(kernel: &Kernel, request: &Req, admitted: impl Fn(&Res) -> bool) {
    let response = send(kernel, "without", request).await;
    assert!(
        refused(&response),
        "a role lacking the permission was admitted: {response:?}"
    );
    let response = send(kernel, "with", request).await;
    assert!(
        admitted(&response),
        "a role holding the permission was refused: {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reading_another_members_record_takes_manage_roles() {
    let kernel = holder_and_lacker(Permission::ManageRoles).await;
    let request = Req::GetMember {
        user_id: "someone".to_string(),
    };
    gate(&kernel, &request, |r| matches!(r, Res::Member(_))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reading_another_members_permissions_takes_manage_roles() {
    let kernel = holder_and_lacker(Permission::ManageRoles).await;
    let request = Req::GetUserPermissions {
        user_id: "someone".to_string(),
        domain_id: ROOT.to_string(),
    };
    gate(&kernel, &request, |r| {
        matches!(r, Res::UserPermissions { .. })
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changing_a_role_takes_manage_roles() {
    let kernel = holder_and_lacker(Permission::ManageRoles).await;
    let request = Req::UpdateMemberRole {
        user_id: "someone".to_string(),
        role: MemberRole::Id(GUEST_ROLE_ID.to_string()),
        metadata: None,
    };
    gate(&kernel, &request, |r| {
        matches!(r, Res::MemberRoleUpdated { .. })
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changing_a_members_grants_takes_manage_roles() {
    let kernel = holder_and_lacker(Permission::ManageRoles).await;
    let request = Req::UpdateMemberPermissions {
        user_id: "someone".to_string(),
        domain_id: ROOT.to_string(),
        permissions: vec![Permission::ViewContent],
        operation: UpdateOperation::Add,
    };
    gate(&kernel, &request, |r| matches!(r, Res::Success(_))).await;
}

/// The roster's grants are role management's to read; every member still sees who is there.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_rosters_grants_are_shown_to_manage_roles() {
    let kernel = holder_and_lacker(Permission::ManageRoles).await;
    send(
        &kernel,
        TEST_ADMIN_USER_ID,
        &Req::UpdateMemberPermissions {
            user_id: "someone".to_string(),
            domain_id: ROOT.to_string(),
            permissions: vec![Permission::EditMdx],
            operation: UpdateOperation::Add,
        },
    )
    .await;

    let grants_seen_by = |actor: &'static str| {
        let kernel = kernel.clone();
        async move {
            let Res::Members { members, .. } =
                send(&kernel, actor, &Req::ListMembers { domain_id: None }).await
            else {
                panic!("{actor} could not list the members");
            };
            let someone = members
                .into_iter()
                .find(|m| m.id == "someone")
                .expect("someone is listed for every member");
            assert!(
                someone.workspace_roles.contains_key(ROOT),
                "the role that labels them is shown to everyone"
            );
            someone.permissions.len()
        }
    };
    assert_eq!(
        grants_seen_by("without").await,
        0,
        "grants shown without ManageRoles"
    );
    assert_eq!(
        grants_seen_by("with").await,
        1,
        "grants hidden from ManageRoles"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_hidden_roster_is_seen_by_whoever_may_hide_it() {
    let kernel = holder_and_lacker(Permission::EditWorkspaceConfig).await;
    let office = office(&kernel).await;
    let hidden = send(
        &kernel,
        TEST_ADMIN_USER_ID,
        &Req::SetMembersVisible {
            node_id: office.clone(),
            visible: false,
        },
    )
    .await;
    assert!(matches!(hidden, Res::Node(_)), "{hidden:?}");

    let request = Req::ListMembers {
        domain_id: Some(office),
    };
    assert!(matches!(
        send(&kernel, "without", &request).await,
        Res::MembersHidden { .. }
    ));
    assert!(matches!(
        send(&kernel, "with", &request).await,
        Res::Members { .. }
    ));
}

async fn office(kernel: &Kernel) -> String {
    match send(
        kernel,
        TEST_ADMIN_USER_ID,
        &Req::CreateNode {
            parent_id: Some(ROOT.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Ops".to_string(),
            description: String::new(),
        },
    )
    .await
    {
        Res::Node(node) => node.id,
        other => panic!("the admin could not create an office: {other:?}"),
    }
}

/// A message the test admin posted, in an office every member can read.
async fn someone_elses_message(kernel: &Kernel) -> (String, String) {
    let office = office(kernel).await;
    let node = kernel
        .domain_operations
        .backend_tx_manager
        .get_node(&office)
        .await
        .expect("read node")
        .expect("the office exists");
    let channel = node.chat_channel_id.expect("a new office has chat");
    let posted = send(
        kernel,
        TEST_ADMIN_USER_ID,
        &Req::SendGroupMessage {
            group_id: channel.clone(),
            message_type: GroupMessageType::Text,
            content: "the admin's words".to_string(),
            reply_to: None,
            mentions: None,
        },
    )
    .await;
    let Res::GroupMessageNotification { message, .. } = posted else {
        panic!("the admin could not post: {posted:?}");
    };
    (channel, message.id)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn editing_someone_elses_message_takes_ban_user() {
    let kernel = holder_and_lacker(Permission::BanUser).await;
    let (group_id, message_id) = someone_elses_message(&kernel).await;
    let request = Req::EditGroupMessage {
        group_id,
        message_id,
        new_content: "moderated".to_string(),
    };
    gate(&kernel, &request, |r| !matches!(r, Res::Error(_))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_someone_elses_message_takes_ban_user() {
    let kernel = holder_and_lacker(Permission::BanUser).await;
    let (group_id, message_id) = someone_elses_message(&kernel).await;
    let request = Req::DeleteGroupMessage {
        group_id,
        message_id,
    };
    gate(&kernel, &request, |r| !matches!(r, Res::Error(_))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_tree_schema_takes_edit_tree_structure() {
    let kernel = holder_and_lacker(Permission::EditTreeStructure).await;
    let request = Req::UpdateTreeSchema {
        schema: TreeSchema::default(),
    };
    gate(&kernel, &request, |r| matches!(r, Res::TreeSchema(_))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_node_type_takes_manage_node_types() {
    let kernel = holder_and_lacker(Permission::ManageNodeTypes).await;
    let request = Req::CreateNodeType {
        name: "Desk".to_string(),
        display_name: "Desk".to_string(),
        icon: None,
        allowed_parents: vec![],
    };
    gate(&kernel, &request, |r| !matches!(r, Res::Error(_))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn renaming_the_workspace_takes_update_workspace() {
    let kernel = holder_and_lacker(Permission::UpdateWorkspace).await;
    let request = Req::UpdateWorkspace {
        workspace_id: None,
        name: Some("Renamed".to_string()),
        description: None,
        metadata: None,
        workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
    };
    gate(&kernel, &request, |r| matches!(r, Res::Workspace(_))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_a_workspace_takes_delete_workspace() {
    let kernel = holder_and_lacker(Permission::DeleteWorkspace).await;
    let created = send(
        &kernel,
        TEST_ADMIN_USER_ID,
        &Req::CreateWorkspace {
            name: "Spare".to_string(),
            description: String::new(),
            workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
            metadata: None,
        },
    )
    .await;
    let Res::Workspace(spare) = created else {
        panic!("the admin could not create a workspace: {created:?}");
    };
    let request = Req::DeleteWorkspace {
        workspace_id: Some(spare.id),
        workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
    };
    gate(&kernel, &request, |r| !matches!(r, Res::Error(_))).await;
}
