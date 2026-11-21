//! A ban is a standing on the account, not a role: it keeps the account out of joining, out of
//! being admitted, and out of every request, until an unban lets it back in.
//!
//! Each refusal is asserted beside the same step succeeding before the ban, so a gate that
//! refused everyone could not pass here.

use citadel_workspace_server_kernel::handlers::domain::async_ops::{
    AsyncPermissionOperations, AsyncUserManagementOperations,
};
use citadel_workspace_server_kernel::{connect_enrolment, ConnectEnrolment};
use citadel_workspace_types::structs::{Permission, User};
use citadel_workspace_types::WorkspaceProtocolResponse as Res;
use common::bans_test_utils::{ban, unban};
use common::member_test_utils::{
    insert_user_with_role, join_root, role_id_of, GateKernel as Kernel,
};
use common::roles_fixture::{GUEST_ROLE_ID, MEMBER_ROLE_ID};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn record(kernel: &Kernel, id: &str) -> User {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(id)
        .await
        .expect("read")
        .expect("the record survives")
}

async fn may_view(kernel: &Kernel, id: &str) -> bool {
    kernel
        .domain_operations
        .check_entity_permission(id, ROOT, Permission::ViewContent)
        .await
        .expect("read")
}

async fn add(kernel: &Kernel, id: &str) -> Result<(), String> {
    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, id, ROOT, GUEST_ROLE_ID.to_string())
        .await
        .map_err(|e| e.to_string())
}

async fn a_member(kernel: &Kernel, id: &str) {
    insert_user_with_role(kernel, id, MEMBER_ROLE_ID).await;
    join_root(kernel, id).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_banned_member_is_refused_joining_admission_and_requests() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "mal").await;
    assert!(
        may_view(&kernel, "mal").await,
        "precondition: a member views the workspace"
    );
    assert_eq!(
        connect_enrolment(Some(&record(&kernel, "mal").await)),
        ConnectEnrolment::Enrol
    );

    let answered = ban(&kernel, TEST_ADMIN_USER_ID, "mal").await;
    assert!(
        matches!(answered, Ok(Res::MemberBanned { ref user_id }) if user_id == "mal"),
        "{answered:?}"
    );

    let banned = record(&kernel, "mal").await;
    assert!(banned.banned, "the ban is on the record");
    assert!(banned.workspace_roles.is_empty() && banned.permissions.is_empty());
    assert_eq!(
        connect_enrolment(Some(&banned)),
        ConnectEnrolment::RefuseRemoved,
        "a banned account joins again on its next connect",
    );
    assert!(
        !may_view(&kernel, "mal").await,
        "a banned account's requests are still served"
    );
    let admitted = add(&kernel, "mal").await;
    assert!(
        admitted.as_ref().is_err_and(|e| e.contains("banned")),
        "AddMember readmitted a banned account: {admitted:?}",
    );
    let promoted = kernel
        .domain_operations
        .update_workspace_member_role(TEST_ADMIN_USER_ID, "mal", MEMBER_ROLE_ID.to_string(), None)
        .await;
    assert!(promoted.is_err(), "a role was given to a banned account");
    assert!(
        record(&kernel, "mal").await.workspace_roles.is_empty(),
        "the refused role change wrote a role anyway"
    );
    assert!(
        !may_view(&kernel, "mal").await,
        "the refused admission left access behind"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_ban_takes_the_role_in_every_workspace() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "mal").await;
    let mut user = record(&kernel, "mal").await;
    user.workspace_roles
        .insert("ws-other".to_string(), MEMBER_ROLE_ID.to_string());
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("mal".to_string(), user)
        .await
        .expect("write");

    ban(&kernel, TEST_ADMIN_USER_ID, "mal")
        .await
        .expect("an admin bans a member");
    assert_eq!(record(&kernel, "mal").await.role_id_in("ws-other"), None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unban_restores_a_banned_member() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "mal").await;
    ban(&kernel, TEST_ADMIN_USER_ID, "mal")
        .await
        .expect("an admin bans a member");
    assert!(
        !may_view(&kernel, "mal").await,
        "precondition: the ban holds"
    );

    let answered = unban(&kernel, TEST_ADMIN_USER_ID, "mal").await;
    assert!(
        matches!(answered, Ok(Res::MemberUnbanned { ref user_id, ref role_id })
            if user_id == "mal" && role_id == MEMBER_ROLE_ID),
        "{answered:?}",
    );
    let restored = record(&kernel, "mal").await;
    assert!(!restored.banned);
    assert_eq!(
        role_id_of(&kernel, "mal").await.as_deref(),
        Some(MEMBER_ROLE_ID),
        "the table's default"
    );
    assert!(
        may_view(&kernel, "mal").await,
        "unbanned, the member still cannot view"
    );
    assert_eq!(connect_enrolment(Some(&restored)), ConnectEnrolment::Enrol);
    add(&kernel, "mal")
        .await
        .expect("an unbanned account may be added again");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unban_readmits_a_removed_member() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "gone").await;
    kernel
        .domain_operations
        .remove_user_from_domain(TEST_ADMIN_USER_ID, "gone", ROOT)
        .await
        .expect("an admin removes a member");
    assert!(
        record(&kernel, "gone").await.banned,
        "removal persists as a ban"
    );

    unban(&kernel, TEST_ADMIN_USER_ID, "gone")
        .await
        .expect("an admin unbans");
    assert!(
        may_view(&kernel, "gone").await,
        "the removed member was not readmitted"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unban_refuses_an_account_that_is_not_banned() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "here").await;
    assert!(unban(&kernel, TEST_ADMIN_USER_ID, "here").await.is_err());
    assert_eq!(
        role_id_of(&kernel, "here").await.as_deref(),
        Some(MEMBER_ROLE_ID)
    );
}
