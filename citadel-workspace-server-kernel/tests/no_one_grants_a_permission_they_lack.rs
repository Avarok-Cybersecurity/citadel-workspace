//! The other door into the same escalation.
//!
//! `no_one_grants_a_role_above_their_own` closed the ROLE path. This is the
//! permission path: `update_member_permissions` was gated on
//! `is_admin_or_owner` and then wrote CALLER-SUPPLIED permissions straight into
//! the target's per-domain map — the target possibly being the caller.
//!
//! So an Owner could grant `Permission::All`, the Admin wildcard that
//! `check_entity_permission` honours before anything else, and with it the
//! `ConfigureSystem` that `Permission::for_role` deliberately withholds from
//! Owner. A role is only a bundle of permissions, so closing one door and not
//! the other closed nothing.
//!
//! Rule: grant what you hold, never more. The permitted grants are asserted
//! beside the refusals — a rule that refused everything would satisfy the
//! refusals alone.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::UpdateOperation;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn try_grant(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    permissions: Vec<Permission>,
    operation: UpdateOperation,
) -> Result<(), String> {
    kernel
        .domain_operations
        .update_member_permissions(actor, target, ROOT, permissions, operation)
        .await
        .map_err(|e| e.to_string())
}

async fn owner_and_target(kernel: &Kernel) {
    insert_user_with_role(kernel, "owner", UserRole::Owner).await;
    join_root(kernel, "owner").await;
    insert_user_with_role(kernel, "target", UserRole::Member).await;
    join_root(kernel, "target").await;
}

// ---------- the escalation ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_cannot_grant_the_admin_wildcard() {
    let kernel = create_test_kernel().await;
    owner_and_target(&kernel).await;

    let outcome = try_grant(
        &kernel,
        "owner",
        "target",
        vec![Permission::All],
        UpdateOperation::Add,
    )
    .await;
    assert!(
        outcome.is_err(),
        "All is honoured ahead of every other check; an Owner does not hold it: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_cannot_grant_the_admin_wildcard_to_themselves() {
    let kernel = create_test_kernel().await;
    owner_and_target(&kernel).await;

    assert!(
        try_grant(
            &kernel,
            "owner",
            "owner",
            vec![Permission::All],
            UpdateOperation::Add
        )
        .await
        .is_err(),
        "the target may be the caller, which is what made this a self-promotion",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_cannot_grant_configure_system() {
    let kernel = create_test_kernel().await;
    owner_and_target(&kernel).await;

    assert!(
        try_grant(
            &kernel,
            "owner",
            "target",
            vec![Permission::ConfigureSystem],
            UpdateOperation::Set
        )
        .await
        .is_err(),
        "for_role withholds ConfigureSystem from Owner, so Owner cannot hand it out",
    );
}

// ---------- what must still work ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_grant_a_permission_they_hold() {
    let kernel = create_test_kernel().await;
    owner_and_target(&kernel).await;

    let outcome = try_grant(
        &kernel,
        "owner",
        "target",
        vec![Permission::SendMessages],
        UpdateOperation::Add,
    )
    .await;
    assert!(
        outcome.is_ok(),
        "containment refuses only what the grantor lacks: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_grant_anything() {
    let kernel = create_test_kernel().await;
    owner_and_target(&kernel).await;

    let outcome = try_grant(
        &kernel,
        TEST_ADMIN_USER_ID,
        "target",
        vec![Permission::All],
        UpdateOperation::Add,
    )
    .await;
    assert!(
        outcome.is_ok(),
        "Admin holds All and has_permission honours it: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_a_permission_is_not_a_grant_and_stays_allowed() {
    let kernel = create_test_kernel().await;
    owner_and_target(&kernel).await;

    // Remove only takes authority away, so it is deliberately not contained —
    // gating it would refuse an Owner tidying up a permission they never held.
    let outcome = try_grant(
        &kernel,
        "owner",
        "target",
        vec![Permission::ConfigureSystem],
        UpdateOperation::Remove,
    )
    .await;
    assert!(outcome.is_ok(), "removal is a de-escalation: {outcome:?}");
}
