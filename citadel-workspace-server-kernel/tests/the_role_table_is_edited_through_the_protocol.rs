//! The role table, driven the way a client drives it: `WorkspaceProtocolRequest::Roles`.
//!
//! The rules of an edit (positions, containment, the fixed Owner) are `role_edits`'s and are
//! tested in `custom_role_test`. These check what only the kernel does: who may send an edit,
//! that it is stored and announced, that holders follow a deleted role to its replacement, and
//! that an edit changes what holders may do at once, including holders whose records predate
//! the table.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::roles::{
    seed_roles, WorkspaceRoles, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID,
};
use citadel_workspace_types::roles_protocol::{RoleChange, RolesRequest, RolesResponse};
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest as Req, WorkspaceProtocolResponse as Res};
use common::member_test_utils::{
    create_test_user, insert_user_with_role, join_root, member_holding, role_id_of, seed_role,
    GateKernel as Kernel,
};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::time::Duration;

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn send(kernel: &Kernel, actor: &str, request: RolesRequest) -> Res {
    process_command_with_user(kernel, &Req::Roles(request), actor)
        .await
        .expect("dispatch")
}

async fn stored(kernel: &Kernel) -> WorkspaceRoles {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_roles(ROOT)
        .await
        .expect("read roles")
}

async fn may(kernel: &Kernel, user: &str, permission: Permission) -> bool {
    kernel
        .domain_operations
        .holds_workspace_permission(user, permission)
        .await
        .expect("permission lookup")
}

fn scribe() -> RolesRequest {
    RolesRequest::Create {
        name: "Scribe".to_string(),
        permissions: vec![Permission::ViewContent, Permission::EditMdx],
        position: 150,
        color: Some("#336699".to_string()),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_reads_the_table_and_a_banned_account_cannot() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "mia", UserRole::Member).await;
    join_root(&kernel, "mia").await;
    insert_user_with_role(&kernel, "bo", UserRole::Banned).await;
    join_root(&kernel, "bo").await;

    match send(&kernel, "mia", RolesRequest::List).await {
        Res::Roles(RolesResponse::Roles(table)) => {
            assert_eq!(
                table,
                WorkspaceRoles::seeded(),
                "an untouched workspace has the seeds"
            )
        }
        other => panic!("a member could not read the table: {other:?}"),
    }
    let banned = send(&kernel, "bo", RolesRequest::List).await;
    assert!(
        matches!(&banned, Res::Error(e) if e.contains("Permission denied")),
        "{banned:?}"
    );
}

/// Refused before the request is read, so the reply cannot tell a prober which edit would
/// have been legal.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_manage_roles_every_edit_is_refused_alike() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "mia", UserRole::Member).await;
    join_root(&kernel, "mia").await;

    let edits = [
        scribe(),
        RolesRequest::Update {
            id: GUEST_ROLE_ID.to_string(),
            changes: vec![RoleChange::Rename("Visitor".to_string())],
        },
        RolesRequest::Delete {
            id: GUEST_ROLE_ID.to_string(),
            reassign_to: MEMBER_ROLE_ID.to_string(),
        },
    ];
    for edit in edits {
        let response = send(&kernel, "mia", edit.clone()).await;
        assert!(
            matches!(&response, Res::Error(e) if e == "Permission denied: ManageRoles required"),
            "{edit:?} answered {response:?}"
        );
    }
    assert_eq!(
        stored(&kernel).await,
        WorkspaceRoles::seeded(),
        "a refused edit was stored"
    );

    let admitted = send(&kernel, TEST_ADMIN_USER_ID, scribe()).await;
    assert!(
        matches!(admitted, Res::Roles(RolesResponse::RoleChanged { .. })),
        "the same edit from an Admin: {admitted:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_created_role_is_stored_and_announced() {
    let kernel = create_test_kernel().await;
    let mut rx = kernel.subscribe_broadcast();

    let Res::Roles(RolesResponse::RoleChanged { role_id, roles }) =
        send(&kernel, TEST_ADMIN_USER_ID, scribe()).await
    else {
        panic!("the Admin could not create a role");
    };
    assert!(role_id.starts_with("role-"), "{role_id}");
    let table = stored(&kernel).await;
    assert_eq!(table, roles, "the reply is not what was stored");
    let created = table.get(&role_id).expect("the role was not stored");
    assert_eq!((created.name.as_str(), created.position), ("Scribe", 150));

    let mut heard = false;
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        heard |= matches!(
            &msg.response,
            Res::Roles(RolesResponse::RoleChanged { role_id: id, .. }) if *id == role_id
        );
    }
    assert!(
        heard,
        "members keep showing and enforcing a table nobody told them changed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_deleted_roles_holders_move_to_the_named_role() {
    let kernel = create_test_kernel().await;
    seed_role(&kernel, "role-scribe", 150, &[Permission::ViewContent]).await;
    member_holding(&kernel, "sam", "role-scribe").await;

    let refused = send(
        &kernel,
        TEST_ADMIN_USER_ID,
        RolesRequest::Delete {
            id: "role-scribe".to_string(),
            reassign_to: OWNER_ROLE_ID.to_string(),
        },
    )
    .await;
    assert!(
        matches!(refused, Res::Error(_)),
        "an Admin moved holders onto the Owner: {refused:?}"
    );
    assert_eq!(
        role_id_of(&kernel, "sam").await.as_deref(),
        Some("role-scribe"),
        "a refused delete still moved its holders"
    );

    let deleted = send(
        &kernel,
        TEST_ADMIN_USER_ID,
        RolesRequest::Delete {
            id: "role-scribe".to_string(),
            reassign_to: GUEST_ROLE_ID.to_string(),
        },
    )
    .await;
    assert!(
        matches!(deleted, Res::Roles(RolesResponse::RoleChanged { .. })),
        "{deleted:?}"
    );
    assert!(stored(&kernel).await.get("role-scribe").is_none());
    assert_eq!(
        role_id_of(&kernel, "sam").await.as_deref(),
        Some(GUEST_ROLE_ID)
    );
    let sam = kernel
        .domain_operations
        .backend_tx_manager
        .get_user("sam")
        .await
        .expect("read")
        .expect("sam");
    assert_eq!(sam.role, UserRole::Guest, "older clients read the enum");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_edit_reaches_the_roles_holders_at_once() {
    let kernel = create_test_kernel().await;
    member_holding(&kernel, "sam", MEMBER_ROLE_ID).await;
    assert!(may(&kernel, "sam", Permission::UploadFiles).await);
    assert!(!may(&kernel, "sam", Permission::EditMdx).await);

    let update = |change: RoleChange| RolesRequest::Update {
        id: MEMBER_ROLE_ID.to_string(),
        changes: vec![change],
    };
    send(
        &kernel,
        TEST_ADMIN_USER_ID,
        update(RoleChange::Revoke(vec![Permission::UploadFiles])),
    )
    .await;
    send(
        &kernel,
        TEST_ADMIN_USER_ID,
        update(RoleChange::Grant(vec![Permission::EditMdx])),
    )
    .await;

    assert!(
        !may(&kernel, "sam", Permission::UploadFiles).await,
        "the revoke did not reach sam"
    );
    assert!(
        may(&kernel, "sam", Permission::EditMdx).await,
        "the grant did not reach sam"
    );
}

/// A record the old role write left: the enum, the Member set copied into the root, no role id.
/// Read through the table, the copy must not outlive an edit to Member.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_record_from_before_the_table_follows_it() {
    let kernel = create_test_kernel().await;
    let mut old = create_test_user("ola", UserRole::Member);
    let member_set = seed_roles()
        .into_iter()
        .find(|role| role.id == MEMBER_ROLE_ID)
        .expect("member seed")
        .permissions;
    old.permissions.insert(ROOT.to_string(), member_set);
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("ola".to_string(), old)
        .await
        .expect("insert");
    join_root(&kernel, "ola").await;
    assert!(may(&kernel, "ola", Permission::SendMessages).await);

    let revoked = send(
        &kernel,
        TEST_ADMIN_USER_ID,
        RolesRequest::Update {
            id: MEMBER_ROLE_ID.to_string(),
            changes: vec![RoleChange::Revoke(vec![Permission::SendMessages])],
        },
    )
    .await;
    assert!(matches!(revoked, Res::Roles(_)), "{revoked:?}");
    assert!(
        !may(&kernel, "ola", Permission::SendMessages).await,
        "the copied Member set outlived the edit to Member"
    );
    assert_eq!(
        role_id_of(&kernel, "ola").await.as_deref(),
        Some(MEMBER_ROLE_ID)
    );
}
