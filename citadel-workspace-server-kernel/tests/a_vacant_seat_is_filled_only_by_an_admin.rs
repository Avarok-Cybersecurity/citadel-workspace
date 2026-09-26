//! The vacant-seat exception in `ensure_may_grant_role` belongs to an Admin.
//!
//! It exists so a workspace, which starts with an Admin and no Owner, can ever
//! gain an Owner. As written it applied to ANY caller: while nobody held Owner,
//! whoever reached the grant could hand it out. AddMember is gated on AddUsers,
//! and an Admin can grant AddUsers to a plain Member through
//! UpdateMemberPermissions -- so that Member could then add anyone, themselves
//! included, as the workspace's Owner.
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::UpdateOperation;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

/// A Member an Admin has trusted with AddUsers at the root.
async fn a_member_who_may_add_people(kernel: &Kernel) {
    insert_user_with_role(kernel, "alice", UserRole::Member).await;
    join_root(kernel, "alice").await;
    kernel
        .domain_operations
        .update_member_permissions(
            TEST_ADMIN_USER_ID,
            "alice",
            ROOT,
            vec![Permission::AddUsers],
            UpdateOperation::Add,
        )
        .await
        .expect("an admin may grant AddUsers");
    insert_user_with_role(kernel, "newcomer", UserRole::Member).await;
}

async fn role_of(kernel: &Kernel, user: &str) -> UserRole {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(user)
        .await
        .expect("read user")
        .expect("user exists")
        .role
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_cannot_make_anyone_the_first_owner() {
    let kernel = create_test_kernel().await;
    a_member_who_may_add_people(&kernel).await;

    // Precondition: AddUsers is really held, so the grant rule is what refuses.
    let added = kernel
        .domain_operations
        .add_user_to_domain("alice", "newcomer", ROOT, UserRole::Guest)
        .await;
    assert!(
        added.is_ok(),
        "alice must be able to add a Guest: {added:?}"
    );

    let outcome = kernel
        .domain_operations
        .add_user_to_domain("alice", "newcomer", ROOT, UserRole::Owner)
        .await;
    assert!(outcome.is_err(), "a Member filled the vacant Owner seat");
    assert_ne!(role_of(&kernel, "newcomer").await, UserRole::Owner);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_cannot_make_themselves_the_first_owner() {
    let kernel = create_test_kernel().await;
    a_member_who_may_add_people(&kernel).await;

    let outcome = kernel
        .domain_operations
        .add_user_to_domain("alice", "alice", ROOT, UserRole::Owner)
        .await;
    assert!(outcome.is_err(), "a Member made themselves Owner");
    assert_eq!(role_of(&kernel, "alice").await, UserRole::Member);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_still_fills_the_vacant_owner_seat() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "newcomer", UserRole::Member).await;

    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "newcomer", ROOT, UserRole::Owner)
        .await
        .expect("an Admin appoints the first Owner");
    assert_eq!(role_of(&kernel, "newcomer").await, UserRole::Owner);
}
