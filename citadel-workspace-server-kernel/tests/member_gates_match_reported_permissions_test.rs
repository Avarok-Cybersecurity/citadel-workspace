//! What `GetUserPermissions` reports must be what enforcement allows.
//!
//! `Permission::for_role` grants an Owner everything except `All` and
//! `ConfigureSystem` — `AddUsers` and `RemoveUsers` among them — and the
//! permission editor renders that set. But `add_member` and `remove_member`
//! gated on `is_admin`, so an Owner was shown grants that enforcement then
//! refused. Any client gating its controls on the reported set (which that
//! endpoint's own doc comment invites) would ship dead buttons.
//!
//! The gates now ask for the permission. That is a widening, so the refusals
//! matter as much as the grant: these tests pin both directions.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::{User, UserRole};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

type Kernel = citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
    citadel_sdk::prelude::MonoRatchet,
>;

async fn user_with_role(kernel: &Kernel, id: &str, role: UserRole) {
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            id.to_string(),
            User {
                id: id.to_string(),
                name: id.to_string(),
                role,
                permissions: HashMap::new(),
                metadata: Default::default(),
            },
        )
        .await
        .expect("insert user");
}

/// Puts `id` in the root workspace's member list, which is what
/// `is_member_of_domain` consults and therefore what scopes the role grant.
async fn join_root(kernel: &Kernel, id: &str) {
    let mgr = &kernel.domain_operations.backend_tx_manager;
    let mut workspace = mgr
        .get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
        .await
        .expect("read workspace")
        .expect("root workspace exists");
    workspace.members.push(id.to_string());
    mgr.insert_workspace(workspace.id.clone(), workspace)
        .await
        .expect("save workspace");
}

async fn try_add(kernel: &Kernel, actor: &str, newcomer: &str) -> Result<(), String> {
    user_with_role(kernel, newcomer, UserRole::Member).await;
    kernel
        .domain_operations
        .add_user_to_domain(
            actor,
            newcomer,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
            UserRole::Member,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_add_members_because_the_reported_set_says_so() {
    let kernel = create_test_kernel().await;
    user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;

    assert!(
        try_add(&kernel, "owner", "newcomer").await.is_ok(),
        "for_role(Owner) grants AddUsers and the permission editor shows it, so \
         enforcement must not refuse it",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_add_members() {
    let kernel = create_test_kernel().await;
    assert!(
        try_add(&kernel, TEST_ADMIN_USER_ID, "newcomer")
            .await
            .is_ok(),
        "administration must keep working",
    );
}

/// The refusals. A widening that also let these through would be a privilege
/// escalation, and no role table grants any of them AddUsers.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ordinary_roles_still_may_not_add_members() {
    for role in [UserRole::Member, UserRole::Guest, UserRole::Banned] {
        let kernel = create_test_kernel().await;
        let actor = format!("{role:?}-actor");
        user_with_role(&kernel, &actor, role.clone()).await;
        join_root(&kernel, &actor).await;

        assert!(
            try_add(&kernel, &actor, "newcomer").await.is_err(),
            "{role:?} holds AddUsers in no role table and must not be able to add members",
        );
    }
}

/// The grant is scoped by membership, not by the global role field.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_who_is_not_a_member_may_not_add_members() {
    let kernel = create_test_kernel().await;
    user_with_role(&kernel, "outside-owner", UserRole::Owner).await;
    // Deliberately NOT joined to the root workspace.

    assert!(
        try_add(&kernel, "outside-owner", "newcomer").await.is_err(),
        "user.role is global, so an Owner of one workspace must gain nothing in another",
    );
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

/// The same fix was applied to both member gates, so both are pinned. A change
/// made in two places and tested in one is how the twin regresses alone.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_remove_members_and_a_member_may_not() {
    let kernel = create_test_kernel().await;
    user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    user_with_role(&kernel, "plain", UserRole::Member).await;
    join_root(&kernel, "plain").await;
    user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    assert!(
        try_remove(&kernel, "plain", "target").await.is_err(),
        "Member holds RemoveUsers in no role table",
    );
    assert!(
        try_remove(&kernel, "owner", "target").await.is_ok(),
        "for_role(Owner) grants RemoveUsers, so enforcement must not refuse it",
    );
}
