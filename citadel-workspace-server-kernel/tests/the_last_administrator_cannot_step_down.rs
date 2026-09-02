//! Nobody may leave the workspace with no one able to administer it.
//!
//! `ensure_not_last_admin` counted `role == Admin` and fired only for an Admin
//! target. That was right while `update_workspace_member_role` was gated on
//! `is_admin`: an Owner could not promote, so an Owner was no escape from an
//! empty admin set — and could not reach the demote path at all.
//!
//! Letting the Owner through that gate (see `owner_gates_admit_the_owner_test`)
//! opened a lockout the guard could not see: an Owner alone in a workspace with
//! no Admin could demote themselves to Member, and the guard no-opped because
//! the target was not an Admin. Nobody left could promote anyone, and the doc
//! comment's own word for that is unrecoverable.
//!
//! The guard now counts Admin AND Owner and fires for either. Both directions
//! are pinned: the lockout is refused, and a step-down with someone left to
//! administer is still allowed — a guard that refused both would be no better.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

/// Make `ids` the workspace's entire membership.
///
/// `create_test_kernel` seeds an Admin member, so a workspace whose only
/// administrator is the Owner has to be built explicitly.
async fn only_members(kernel: &Kernel, ids: &[&str]) {
    let mgr = &kernel.domain_operations.backend_tx_manager;
    let mut workspace = mgr
        .get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
        .await
        .expect("read workspace")
        .expect("root workspace exists");
    workspace.members = ids.iter().map(|s| s.to_string()).collect();
    mgr.insert_workspace(workspace.id.clone(), workspace)
        .await
        .expect("save workspace");
}

async fn try_demote(kernel: &Kernel, actor: &str, target: &str) -> Result<(), String> {
    kernel
        .domain_operations
        .update_workspace_member_role(actor, target, UserRole::Member, None)
        .await
        .map_err(|e| e.to_string())
}

async fn try_remove(kernel: &Kernel, actor: &str, target: &str) -> Result<(), String> {
    kernel
        .domain_operations
        .remove_user_from_domain(
            actor,
            target,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lone_owner_cannot_demote_themselves() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    only_members(&kernel, &["owner"]).await;

    assert!(
        try_demote(&kernel, "owner", "owner").await.is_err(),
        "the only administrator stepping down leaves nobody who can promote anyone",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lone_owner_cannot_be_removed() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    only_members(&kernel, &["owner"]).await;

    assert!(
        try_remove(&kernel, "owner", "owner").await.is_err(),
        "removal empties the administrator set exactly as demotion does",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_step_down_while_an_admin_remains() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    only_members(&kernel, &["owner", TEST_ADMIN_USER_ID]).await;

    let outcome = try_demote(&kernel, "owner", "owner").await;
    assert!(
        outcome.is_ok(),
        "two administrators, so stepping down strands nobody: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_last_admin_is_still_protected_when_the_owner_is_the_other_one() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    only_members(&kernel, &["owner", TEST_ADMIN_USER_ID]).await;

    // Counting Owners is a widening, so the refusal that matters is the one
    // that must survive it: with the Admin gone, the Owner is the last
    // administrator and cannot follow.
    assert!(
        try_demote(&kernel, "owner", TEST_ADMIN_USER_ID)
            .await
            .is_ok(),
        "the Owner still counts, so demoting the Admin is safe",
    );
    assert!(
        try_demote(&kernel, "owner", "owner").await.is_err(),
        "and now the Owner is the last one and must be refused",
    );
}
