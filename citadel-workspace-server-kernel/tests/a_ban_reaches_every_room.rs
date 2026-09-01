//! Banning must take away the rooms, not just the workspace.
//!
//! `set_role_permissions` writes exactly one key, so banning a member rewrote
//! `permissions[WORKSPACE_ROOT_ID]` and left every per-node grant standing.
//! `add_user_to_domain` writes one of those for each office or room a member is
//! added to, and `check_entity_permission` honours a direct grant BEFORE it
//! consults role or membership.
//!
//! So a banned account kept `ViewContent` and `SendMessages` in every room it
//! had been added to: it could still read that room's roster through
//! `ListMembers { domain_id: O }`, and still read AND post in its chat through
//! `authorize_group_read` / `authorize_group_write`.
//!
//! Meanwhile `ensure_may_view_workspace` asks at the root, so the same account
//! was correctly refused `GetNode`, `ListNodes` and `GetTreeStructure`. Two
//! gates added in one round, disagreeing about one user — which is the shape
//! worth testing, not either gate alone.

use citadel_workspace_server_kernel::handlers::domain::async_ops::{
    AsyncPermissionOperations, AsyncUserManagementOperations,
};
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use citadel_workspace_types::UpdateOperation;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

/// An office the member is a member of, with a per-node grant of its own.
async fn office_with(kernel: &Kernel, user: &str, role: UserRole) -> String {
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
        .add_user_to_domain(TEST_ADMIN_USER_ID, user, &office.id, role)
        .await
        .expect("an admin may add a member to an office");

    office.id
}

async fn may(kernel: &Kernel, user: &str, domain: &str, permission: Permission) -> bool {
    kernel
        .domain_operations
        .check_entity_permission(user, domain, permission)
        .await
        .unwrap_or(false)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_ban_revokes_the_room_grants_too() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "outcast", UserRole::Member).await;
    join_root(&kernel, "outcast").await;
    let office = office_with(&kernel, "outcast", UserRole::Member).await;

    // Without this the assertions below pass on a build where the member never
    // held the grant in the first place.
    assert!(
        may(&kernel, "outcast", &office, Permission::ViewContent).await,
        "a member added to an office must hold ViewContent there",
    );
    assert!(
        may(&kernel, "outcast", &office, Permission::SendMessages).await,
        "a member added to an office must hold SendMessages there",
    );

    kernel
        .domain_operations
        .update_workspace_member_role(TEST_ADMIN_USER_ID, "outcast", UserRole::Banned, None)
        .await
        .expect("an admin may set a role to Banned");

    assert!(
        !may(&kernel, "outcast", &office, Permission::ViewContent).await,
        "the ban left the office grant standing, so the roster and chat are still readable",
    );
    assert!(
        !may(&kernel, "outcast", &office, Permission::SendMessages).await,
        "the ban left the office grant standing, so a banned account can still post",
    );
    assert!(
        !may(&kernel, "outcast", ROOT, Permission::ViewContent).await,
        "the root grant survived the ban",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_demotion_that_is_not_a_ban_leaves_a_deliberate_grant_alone() {
    // The scope. Revoking every grant on ANY role change would also wipe a
    // per-domain grant an admin set deliberately through
    // update_member_permissions — a promotion must not silently redistribute
    // authority, and a demotion must not reach into a room it was not about.
    //
    // The grant here is EditTreeStructure, which no role below Admin holds. A
    // grant that merely matches the role's own table proves nothing: the role
    // fallback in check_entity_permission would answer true whether the direct
    // grant survived or not, which is how the first version of this test passed
    // against a build that cleared everything.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "member", UserRole::Member).await;
    join_root(&kernel, "member").await;
    let office = office_with(&kernel, "member", UserRole::Member).await;

    kernel
        .domain_operations
        .update_member_permissions(
            TEST_ADMIN_USER_ID,
            "member",
            &office,
            vec![Permission::EditTreeStructure],
            UpdateOperation::Add,
        )
        .await
        .expect("an admin may grant a permission in an office");
    assert!(
        may(&kernel, "member", &office, Permission::EditTreeStructure).await,
        "the deliberate grant was never made, so nothing below is measured",
    );

    kernel
        .domain_operations
        .update_workspace_member_role(TEST_ADMIN_USER_ID, "member", UserRole::Guest, None)
        .await
        .expect("an admin may set a role to Guest");

    assert!(
        may(&kernel, "member", &office, Permission::EditTreeStructure).await,
        "a demotion to Guest wiped a grant an admin had set deliberately elsewhere",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_banned_member_is_refused_the_tree_as_well() {
    // The gate that already worked, kept beside the one that did not, so a
    // future change cannot fix one and break the other without saying so.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "outcast", UserRole::Member).await;
    join_root(&kernel, "outcast").await;
    let _office = office_with(&kernel, "outcast", UserRole::Member).await;

    kernel
        .domain_operations
        .update_workspace_member_role(TEST_ADMIN_USER_ID, "outcast", UserRole::Banned, None)
        .await
        .expect("an admin may set a role to Banned");

    assert!(
        kernel
            .domain_operations
            .list_nodes("outcast", None, None, None)
            .await
            .is_err(),
        "the node readers admitted a banned account",
    );
}
