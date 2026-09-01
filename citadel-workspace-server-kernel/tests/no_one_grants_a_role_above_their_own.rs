//! You cannot hand out a role that outranks you.
//!
//! `add_user_to_domain` writes a caller-supplied `UserRole` and was gated only
//! on `AddUsers` — which `Permission::for_role` grants to every Custom role
//! above the editor threshold (rank > 15). Nothing inspected WHICH role was
//! being granted, and `user_id_to_add` may be the caller. So:
//!
//!     add_user_to_domain(me, me, WORKSPACE_ROOT, UserRole::Admin)
//!
//! passed the gate, reached `write_user_role`, and set the caller's own role to
//! Admin — which carries `Permission::All`. A rank-16 Custom role could make
//! itself an administrator.
//!
//! `update_workspace_member_role` is the same shape and gained the same reach
//! when it began admitting the Owner: an Owner could grant Admin, and with it
//! the `ConfigureSystem` that `for_role` deliberately withholds from Owner.
//!
//! The rule is containment, using the ranks `UserRole` already carries: grant
//! what you outrank or match, never what is above you. The permitted grants are
//! asserted alongside the refusals — a rule that refused everything would
//! satisfy the refusals alone.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

/// Rank 16: above `CUSTOM_EDITOR_THRESHOLD`, so `for_role` grants it AddUsers.
fn elevated_custom() -> UserRole {
    UserRole::create_custom_role("elevated".to_string(), 16).expect("rank 16 is not reserved")
}

async fn try_add_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    role: UserRole,
) -> Result<(), String> {
    kernel
        .domain_operations
        .add_user_to_domain(actor, target, ROOT, role)
        .await
        .map_err(|e| e.to_string())
}

async fn try_set_role_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    role: UserRole,
) -> Result<(), String> {
    kernel
        .domain_operations
        .update_workspace_member_role(actor, target, role, None)
        .await
        .map_err(|e| e.to_string())
}

// ---------- the escalation ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_cannot_make_itself_an_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "climber", elevated_custom()).await;
    join_root(&kernel, "climber").await;

    let outcome = try_add_as(&kernel, "climber", "climber", UserRole::Admin).await;
    assert!(
        outcome.is_err(),
        "AddUsers must not be a route to Permission::All: {outcome:?}",
    );

    let after = kernel
        .domain_operations
        .backend_tx_manager
        .get_user("climber")
        .await
        .expect("read user")
        .expect("user exists");
    assert_ne!(
        after.role,
        UserRole::Admin,
        "the refusal must also leave the role unwritten",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_cannot_mint_an_admin_accomplice() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "climber", elevated_custom()).await;
    join_root(&kernel, "climber").await;

    assert!(
        try_add_as(&kernel, "climber", "accomplice", UserRole::Admin)
            .await
            .is_err(),
        "granting Admin to someone else is the same escalation, one step longer",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_cannot_grant_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    assert!(
        try_set_role_as(&kernel, "owner", "target", UserRole::Admin)
            .await
            .is_err(),
        "Admin carries ConfigureSystem, which for_role withholds from Owner",
    );
}

// ---------- what must still work ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_grant_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, TEST_ADMIN_USER_ID, "target", UserRole::Admin).await;
    assert!(
        outcome.is_ok(),
        "Admin is u8::MAX and matches itself, so promotion must still work: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_grant_the_roles_beneath_them() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = try_set_role_as(&kernel, "owner", "target", UserRole::Guest).await;
    assert!(
        outcome.is_ok(),
        "containment blocks only what is above the grantor: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_custom_role_may_still_add_ordinary_members() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "climber", elevated_custom()).await;
    join_root(&kernel, "climber").await;

    let outcome = try_add_as(&kernel, "climber", "newcomer", UserRole::Member).await;
    assert!(
        outcome.is_ok(),
        "AddUsers still means what it says for roles beneath the grantor: {outcome:?}",
    );
}
