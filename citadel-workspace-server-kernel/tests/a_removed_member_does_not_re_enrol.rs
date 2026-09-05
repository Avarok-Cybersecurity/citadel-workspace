//! Removing a member lasted until they reconnected.
//!
//! The connection handler enrols any authenticated account that is absent from
//! `workspace.members` -- "no admin required for initial connection". It could
//! not tell "never joined" from "an administrator removed them", so
//! `RemoveMember` was undone by the removed account's own next reconnect, which
//! happens automatically. Nothing was logged. The member list showed them back.
//!
//! Existing coverage asserted only the ROLE side-effect of removal
//! (`removal_takes_the_role_from_an_owner_too.rs`); nothing asserted that
//! removal persisted, which is the thing removal is for.
//!
//! Two halves, tested where each lives:
//!   * the decision, as a pure function, the way `first_member_outcome` is;
//!   * the record removal leaves behind, through the real backend.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_server_kernel::{connect_enrolment, ConnectEnrolment};
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

// --- the decision -----------------------------------------------------------

#[test]
fn a_removed_account_is_not_re_enrolled() {
    // The defect, stated as a test.
    assert_eq!(
        connect_enrolment(Some(UserRole::Banned)),
        ConnectEnrolment::RefuseRemoved,
        "a removed account reconnecting must not add itself back",
    );
}

#[test]
fn an_account_that_never_joined_is_still_enrolled() {
    // The control. If this goes red the fix closed the door on everyone and
    // nobody can join at all -- which no assertion about removal would catch.
    assert_eq!(connect_enrolment(None), ConnectEnrolment::Enrol);
}

#[test]
fn every_other_role_is_still_enrolled() {
    for role in [
        UserRole::Member,
        UserRole::Guest,
        UserRole::Admin,
        UserRole::Owner,
        UserRole::Custom("editor".to_string(), 5),
    ] {
        assert_eq!(
            connect_enrolment(Some(role.clone())),
            ConnectEnrolment::Enrol,
            "{role:?} is not a removed account and must still be able to connect",
        );
    }
}

// --- the record removal leaves ----------------------------------------------

async fn role_of(kernel: &Kernel, user: &str) -> UserRole {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(user)
        .await
        .expect("backend read")
        .expect("user exists")
        .role
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removal_leaves_a_record_the_connect_path_can_read() {
    // The two halves joined: whatever removal writes must be what the decision
    // reads. Asserting them separately would let the fix pass while the two
    // sides disagreed.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "departing", UserRole::Member).await;
    join_root(&kernel, "departing").await;

    assert_eq!(
        connect_enrolment(Some(role_of(&kernel, "departing").await)),
        ConnectEnrolment::Enrol,
        "before removal this account would be enrolled, or nothing below is measured",
    );

    kernel
        .domain_operations
        .remove_user_from_domain(TEST_ADMIN_USER_ID, "departing", ROOT)
        .await
        .expect("an admin may remove a member");

    assert_eq!(
        connect_enrolment(Some(role_of(&kernel, "departing").await)),
        ConnectEnrolment::RefuseRemoved,
        "removal must leave a record the connect path reads, or it lasts one reconnect",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_removed_account_holds_no_permissions_on_the_root() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "departing", UserRole::Admin).await;
    join_root(&kernel, "departing").await;

    kernel
        .domain_operations
        .remove_user_from_domain(TEST_ADMIN_USER_ID, "departing", ROOT)
        .await
        .expect("an admin may remove a member");

    assert!(
        !kernel
            .domain_operations
            .is_admin_or_owner("departing")
            .await
            .expect("backend read"),
        "a removed administrator keeps every is_admin_or_owner gate if the role survives",
    );
}
