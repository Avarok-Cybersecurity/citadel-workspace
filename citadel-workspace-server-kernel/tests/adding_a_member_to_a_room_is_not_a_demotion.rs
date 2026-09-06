//! Adding someone to a room says what they may do IN THAT ROOM, and nothing else.
//!
//! `add_user_to_domain` ends in `write_user_role_locked`, which writes
//! `user.role` — the GLOBAL role, the one field `is_admin` reads — whatever
//! `domain_id` it was given. So `AddMember { user_id: A, domain_id: <a room>,
//! role: Guest }` did not grant A a guest's rights in that room; it made A a
//! Guest everywhere.
//!
//! The gate above it does not catch this. `ensure_may_grant_role` refuses only
//! roles ABOVE the actor's own, so an Owner adding an Admin to a room as a
//! Guest passes it, and `ensure_not_last_admin` passes too while a second
//! admin exists. Two admins, and either can silently strip the other.
use citadel_workspace_server_kernel::handlers::domain::async_ops::{
    AsyncUserManagementOperations,
};
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn role_of(kernel: &Kernel, user: &str) -> UserRole {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(user)
        .await
        .expect("read user")
        .expect("the user exists")
        .role
}

/// A room, created where the tree allows one: under an office, not the root.
async fn a_room(kernel: &Kernel) -> String {
    let office = kernel
        .domain_operations
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(ROOT),
            &NodeEntityType::Child("Office".to_string()),
            "Ops",
            "",
        )
        .await
        .expect("an admin may create an office");
    kernel
        .domain_operations
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(&office.id),
            &NodeEntityType::Child("Room".to_string()),
            "Standup",
            "",
        )
        .await
        .expect("an admin may create a room in an office")
        .id
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn adding_an_admin_to_a_room_does_not_change_their_workspace_role() {
    let kernel = create_test_kernel().await;
    // A second admin, so the last-admin guard is not what is being tested.
    insert_user_with_role(&kernel, "second_admin", UserRole::Admin).await;
    join_root(&kernel, "second_admin").await;
    let room = a_room(&kernel).await;

    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "second_admin", &room, UserRole::Guest)
        .await
        .expect("an admin may add a member to a room");

    assert_eq!(
        role_of(&kernel, "second_admin").await,
        UserRole::Admin,
        "adding an admin to one room must not demote them workspace-wide",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_role_given_still_scopes_what_they_may_do_in_that_room() {
    // The fix must not turn the role argument into decoration: a guest added to
    // a room gets a guest's permissions THERE.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "visitor", UserRole::Member).await;
    join_root(&kernel, "visitor").await;
    let room = a_room(&kernel).await;

    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "visitor", &room, UserRole::Guest)
        .await
        .expect("an admin may add a member to a room");

    let guest_may = Permission::for_role(&UserRole::Guest);
    let granted = kernel
        .domain_operations
        .backend_tx_manager
        .get_user("visitor")
        .await
        .expect("read user")
        .expect("the user exists")
        .permissions
        .get(&room)
        .cloned()
        .expect("the room grant was written");
    assert_eq!(
        granted, guest_may,
        "the room grant must reflect the role given"
    );
    assert_eq!(
        role_of(&kernel, "visitor").await,
        UserRole::Member,
        "and the workspace role must be untouched",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_role_change_at_the_root_still_changes_the_workspace_role() {
    // The counterpart: at the root, the role IS the workspace role, and this
    // must keep working — otherwise the fix would break promotion entirely.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "promotable", UserRole::Member).await;
    join_root(&kernel, "promotable").await;

    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "promotable", ROOT, UserRole::Admin)
        .await
        .expect("an admin may set a member's workspace role at the root");

    assert_eq!(role_of(&kernel, "promotable").await, UserRole::Admin);
}
