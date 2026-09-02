//! Removing an Admin demotes them. Removing an Owner did nothing.
//!
//! `remove_user_from_domain` drops the role as well as the membership, and the
//! comment explaining why says it plainly: `is_admin` reads the GLOBAL
//! `user.role` and never consults the member list, so a removed administrator
//! keeps passing every gate while `ensure_not_last_admin` — which counts
//! administrators among `workspace.members` — can no longer see them.
//!
//! The check was `removed.role == UserRole::Admin`, written when Admin was the
//! only role that gated anything. `is_admin_or_owner` later became the gate on
//! `update_workspace_member_role`, `update_member_permissions` and
//! UpdateTreeSchema, and `ensure_not_last_admin` grew to count Owner — its own
//! doc says "once the Owner gained that gate, the guard had to follow". This
//! demotion did not follow. A removed Owner kept all three.
//!
//! Not an escalation: the Owner gains nothing they did not already hold. It is a
//! revocation that revoked nothing, which is why the Admin case is the control —
//! the same call, one role over, has always worked.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

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

/// The authority that outlives removal if the role does: `is_admin_or_owner` is
/// the whole gate on role assignment, permission editing and schema writes.
async fn still_administers(kernel: &Kernel, user: &str) -> bool {
    kernel
        .domain_operations
        .is_admin_or_owner(user)
        .await
        .expect("backend read")
}

async fn remove(kernel: &Kernel, target: &str) {
    kernel
        .domain_operations
        .remove_user_from_domain(TEST_ADMIN_USER_ID, target, ROOT)
        .await
        .expect("an admin may remove a member");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_an_owner_takes_the_role() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "founder", UserRole::Owner).await;
    join_root(&kernel, "founder").await;
    assert!(
        still_administers(&kernel, "founder").await,
        "an Owner administers before removal, or nothing below is being measured",
    );

    remove(&kernel, "founder").await;

    assert_eq!(
        role_of(&kernel, "founder").await,
        UserRole::Member,
        "a removed Owner kept the role, and with it every is_admin_or_owner gate",
    );
    assert!(
        !still_administers(&kernel, "founder").await,
        "the role is the gate; leaving it in place leaves the authority in place",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_an_admin_still_takes_the_role() {
    // The case that always worked. If this ever goes red the fix above broke the
    // branch it widened rather than widening it.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "deputy", UserRole::Admin).await;
    join_root(&kernel, "deputy").await;

    remove(&kernel, "deputy").await;

    assert_eq!(role_of(&kernel, "deputy").await, UserRole::Member);
    assert!(!still_administers(&kernel, "deputy").await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_a_plain_member_leaves_their_role_alone() {
    // The demotion must be scoped to administrators. A Guest removed from the
    // workspace is still a Guest, not silently promoted to Member.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "visitor", UserRole::Guest).await;
    join_root(&kernel, "visitor").await;

    remove(&kernel, "visitor").await;

    assert_eq!(role_of(&kernel, "visitor").await, UserRole::Guest);
}
