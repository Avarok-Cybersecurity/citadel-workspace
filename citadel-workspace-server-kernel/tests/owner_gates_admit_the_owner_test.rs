//! The Owner is refused by every gate still written on `is_admin`.
//!
//! `member_gates_match_reported_permissions_test.rs` moved `add_member` and
//! `remove_member` off `is_admin` and records why. Three more gates were left
//! behind, so an Owner could add and remove members and still not change a
//! role, change a member's permissions, or edit the tree schema — in their own
//! workspace, while the permission editor showed them holding every grant.
//!
//! `is_admin` is `role == Admin` exactly, and `Permission::for_role` gives an
//! Owner everything except `All` and `ConfigureSystem`.
//!
//! These gates admit Admin and Owner and no one else — a policy choice, not the
//! only barrier. When this was written it WAS the only barrier: widening them
//! would then have let a holder of a member-management permission mint an Admin.
//! `no_one_grants_a_role_above_their_own` and `no_one_grants_a_permission_they_lack`
//! closed that independently, so the refusals below pin the narrower behaviour
//! actually implemented, not a defence the escalation still depends on.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

// ---------------------------------------------------------------------------
// The same mistake, two functions further down, never propagated.
//
// `add_member` and `remove_member` were moved off `is_admin`; the header above
// records why. `update_workspace_member_role` and `update_member_permissions`
// were not, so the Owner could add and remove members and still not change
// anyone's role — in their own workspace, while the editor showed the grant.
//
// These gates admit Admin and Owner and no one else. Assigning a role can
// promote someone to Admin, so widening them to every holder of a
// member-management permission would let a Custom role above editor rank mint
// an administrator; that is a policy change, and the refusals below pin the
// narrower behaviour actually implemented.
// ---------------------------------------------------------------------------

async fn try_set_role(kernel: &Kernel, actor: &str, target: &str) -> Result<(), String> {
    insert_user_with_role(kernel, target, UserRole::Member).await;
    join_root(kernel, target).await;
    kernel
        .domain_operations
        .update_workspace_member_role(actor, target, UserRole::Guest, None)
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_change_a_members_role() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;

    assert!(
        try_set_role(&kernel, "owner", "target").await.is_ok(),
        "the Owner runs the workspace; gating this on is_admin refused them",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_change_a_members_role() {
    let kernel = create_test_kernel().await;
    assert!(
        try_set_role(&kernel, TEST_ADMIN_USER_ID, "target")
            .await
            .is_ok(),
        "administration must keep working",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ordinary_roles_still_may_not_change_roles() {
    for role in [UserRole::Member, UserRole::Guest, UserRole::Banned] {
        let kernel = create_test_kernel().await;
        let actor = format!("{role:?}-role-actor");
        insert_user_with_role(&kernel, &actor, role.clone()).await;
        join_root(&kernel, &actor).await;

        assert!(
            try_set_role(&kernel, &actor, "target").await.is_err(),
            "{role:?} must not be able to assign roles: it is a path to Admin",
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_change_a_members_permissions() {
    use citadel_workspace_types::structs::Permission;
    use citadel_workspace_types::UpdateOperation;
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "target", UserRole::Member).await;
    join_root(&kernel, "target").await;

    let outcome = kernel
        .domain_operations
        .update_member_permissions(
            "owner",
            "target",
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
            vec![Permission::SendMessages],
            UpdateOperation::Add,
        )
        .await;

    assert!(
        outcome.is_ok(),
        "same gate, same refusal of the Owner: {outcome:?}",
    );
}

// ---------------------------------------------------------------------------
// The third site, in the dispatch layer rather than the ops layer.
//
// UpdateTreeSchema gated on `is_admin` with no membership fallback — unlike the
// read gates nearby, which are `is_admin || is_member` and which an Owner
// therefore passes as a member. So the Owner could not change the tree schema of
// their own workspace while holding EditTreeStructure in the reported set.
// ---------------------------------------------------------------------------

async fn try_update_schema(kernel: &Kernel, actor: &str) -> Result<(), String> {
    use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
    use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

    let request = WorkspaceProtocolRequest::UpdateTreeSchema {
        schema: Default::default(),
    };
    match process_command_with_user(kernel, &request, actor).await {
        Ok(WorkspaceProtocolResponse::Error(message)) => Err(message),
        Ok(_) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_update_the_tree_schema() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;

    let outcome = try_update_schema(&kernel, "owner").await;
    assert!(
        outcome.is_ok(),
        "the Owner holds EditTreeStructure and the editor shows it: {outcome:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ordinary_roles_still_may_not_update_the_tree_schema() {
    for role in [UserRole::Member, UserRole::Guest, UserRole::Banned] {
        let kernel = create_test_kernel().await;
        let actor = format!("{role:?}-schema-actor");
        insert_user_with_role(&kernel, &actor, role.clone()).await;
        join_root(&kernel, &actor).await;

        assert!(
            try_update_schema(&kernel, &actor).await.is_err(),
            "{role:?} must not be able to rewrite the tree schema",
        );
    }
}
