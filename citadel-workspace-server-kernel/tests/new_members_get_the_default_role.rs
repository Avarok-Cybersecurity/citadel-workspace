//! The role new members get is the table's, not a role id written in code.
//!
//! Three halves: the edits that set it (`role_edits`, pure), the protocol that gates and
//! announces them, and the connect path that reads it (`give_joiner_the_default_role`, through
//! the real backend). Every refusal has the permitted edit beside it.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::role_edits::{delete, update};
use citadel_workspace_types::roles::{
    RoleDefinition, WorkspaceRoles, ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID,
};
use citadel_workspace_types::roles_protocol::{RoleChange, RolesRequest, RolesResponse};
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest as Req, WorkspaceProtocolResponse as Res};
use common::member_test_utils::{
    insert_user_with_role, join_root, member_holding, role_id_of, seed_role, GateKernel as Kernel,
};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::time::Duration;

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

fn role(table: &WorkspaceRoles, id: &str) -> RoleDefinition {
    table.get(id).unwrap_or_else(|| panic!("no {id}")).clone()
}

fn make_default() -> Vec<RoleChange> {
    vec![RoleChange::MakeDefault]
}

// ---------- the edits ----------

#[test]
fn an_admin_makes_a_role_below_them_the_default() {
    let table = WorkspaceRoles::seeded();
    let next = update(
        &table,
        &role(&table, ADMIN_ROLE_ID),
        GUEST_ROLE_ID,
        &make_default(),
    )
    .expect("Guest is below an Admin");
    assert_eq!(next.default_role_id, GUEST_ROLE_ID);
    assert_eq!(
        next.get(GUEST_ROLE_ID),
        table.get(GUEST_ROLE_ID),
        "the role itself changed"
    );
}

#[test]
fn the_default_is_never_the_owner_nor_at_or_above_the_actor() {
    let table = WorkspaceRoles::seeded();
    let owner = role(&table, OWNER_ROLE_ID);
    let admin = role(&table, ADMIN_ROLE_ID);
    for (actor, id) in [
        (&owner, OWNER_ROLE_ID),
        (&admin, OWNER_ROLE_ID),
        (&admin, ADMIN_ROLE_ID),
    ] {
        assert!(
            update(&table, actor, id, &make_default()).is_err(),
            "{} made {id} the default",
            actor.name
        );
    }
    assert!(update(&table, &owner, ADMIN_ROLE_ID, &make_default()).is_ok());
}

/// Making a role the default hands it to everyone who joins, so it is an assignment: the actor
/// must hold what it carries, as when edited in the same request.
#[test]
fn the_default_carries_nothing_the_actor_lacks() {
    let mut table = WorkspaceRoles::seeded();
    let lead = RoleDefinition {
        id: "role-lead".into(),
        name: "Lead".into(),
        permissions: [Permission::ManageRoles, Permission::ViewContent]
            .into_iter()
            .collect(),
        position: 250,
        color: None,
    };
    table.roles.push(lead.clone());
    let table = table.normalized();

    let refused = update(&table, &lead, MEMBER_ROLE_ID, &make_default());
    assert!(
        refused.is_err(),
        "Lead handed every joiner SendMessages: {refused:?}"
    );

    let mut stripped = make_default();
    stripped.insert(
        0,
        RoleChange::Revoke(
            role(&table, MEMBER_ROLE_ID)
                .permissions
                .into_iter()
                .collect(),
        ),
    );
    stripped.insert(1, RoleChange::Grant(vec![Permission::ViewContent]));
    let next = update(&table, &lead, MEMBER_ROLE_ID, &stripped).expect("only what Lead holds");
    assert_eq!(next.default_role_id, MEMBER_ROLE_ID);
}

#[test]
fn deleting_the_default_makes_its_replacement_the_default() {
    let table = WorkspaceRoles::seeded();
    let admin = role(&table, ADMIN_ROLE_ID);
    let next = delete(&table, &admin, MEMBER_ROLE_ID, GUEST_ROLE_ID).expect("delete Member");
    assert_eq!(next.default_role_id, GUEST_ROLE_ID);
    assert!(next.default_role().is_some());

    // The control: deleting another role leaves the default where it was.
    let next = delete(&table, &admin, GUEST_ROLE_ID, MEMBER_ROLE_ID).expect("delete Guest");
    assert_eq!(next.default_role_id, MEMBER_ROLE_ID);
}

#[test]
fn the_default_cannot_be_deleted_onto_the_owner() {
    let table = WorkspaceRoles::seeded();
    let owner = role(&table, OWNER_ROLE_ID);
    let refused = delete(&table, &owner, MEMBER_ROLE_ID, OWNER_ROLE_ID);
    assert!(
        matches!(&refused, Err(e) if e.contains("new members")),
        "{refused:?}"
    );
    assert!(
        delete(&table, &owner, GUEST_ROLE_ID, OWNER_ROLE_ID).is_ok(),
        "the Owner may still move a non-default role's holders onto the Owner"
    );
}

// ---------- the protocol ----------

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

fn make_guest_default() -> RolesRequest {
    RolesRequest::Update {
        id: GUEST_ROLE_ID.to_string(),
        changes: vec![RoleChange::MakeDefault],
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn setting_the_default_takes_manage_roles_and_is_announced() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "mia", UserRole::Member).await;
    join_root(&kernel, "mia").await;

    let refused = send(&kernel, "mia", make_guest_default()).await;
    assert!(
        matches!(&refused, Res::Error(e) if e == "Permission denied: ManageRoles required"),
        "{refused:?}"
    );
    assert_eq!(stored(&kernel).await.default_role_id, MEMBER_ROLE_ID);

    let mut rx = kernel.subscribe_broadcast();
    let answer = send(&kernel, TEST_ADMIN_USER_ID, make_guest_default()).await;
    assert!(
        matches!(&answer, Res::Roles(RolesResponse::RoleChanged { role_id, roles })
            if role_id == GUEST_ROLE_ID && roles.default_role_id == GUEST_ROLE_ID),
        "{answer:?}"
    );
    assert_eq!(
        stored(&kernel).await.default_role_id,
        GUEST_ROLE_ID,
        "not stored"
    );

    let mut heard = false;
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        heard |= matches!(&msg.response,
            Res::Roles(RolesResponse::RoleChanged { roles, .. }) if roles.default_role_id == GUEST_ROLE_ID);
    }
    assert!(
        heard,
        "other administrators' editors keep showing the old default"
    );
}

// ---------- joining ----------

async fn join_on_connect(kernel: &Kernel, id: &str) {
    kernel
        .domain_operations
        .give_joiner_the_default_role(id, id.to_string())
        .await
        .expect("join");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_joiner_gets_the_tables_default_role() {
    let kernel = create_test_kernel().await;
    join_on_connect(&kernel, "new-1").await;
    assert_eq!(
        role_id_of(&kernel, "new-1").await.as_deref(),
        Some(MEMBER_ROLE_ID)
    );

    send(&kernel, TEST_ADMIN_USER_ID, make_guest_default()).await;
    join_on_connect(&kernel, "new-2").await;
    assert_eq!(
        role_id_of(&kernel, "new-2").await.as_deref(),
        Some(GUEST_ROLE_ID),
        "a joiner ignored the default an administrator set"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn after_the_default_is_deleted_joiners_get_its_replacement() {
    let kernel = create_test_kernel().await;
    seed_role(
        &kernel,
        "role-crew",
        150,
        &[Permission::ViewContent, Permission::SendMessages],
    )
    .await;
    let deleted = send(
        &kernel,
        TEST_ADMIN_USER_ID,
        RolesRequest::Delete {
            id: MEMBER_ROLE_ID.to_string(),
            reassign_to: "role-crew".to_string(),
        },
    )
    .await;
    assert!(matches!(deleted, Res::Roles(_)), "{deleted:?}");

    join_on_connect(&kernel, "new-3").await;
    assert_eq!(
        role_id_of(&kernel, "new-3").await.as_deref(),
        Some("role-crew"),
        "a joiner was given a role the table no longer has"
    );
}

/// An account an administrator gave a role before it first connected keeps it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_role_chosen_before_joining_is_kept() {
    let kernel = create_test_kernel().await;
    member_holding(&kernel, "sam", ADMIN_ROLE_ID).await;
    join_on_connect(&kernel, "sam").await;
    assert_eq!(
        role_id_of(&kernel, "sam").await.as_deref(),
        Some(ADMIN_ROLE_ID)
    );
}
