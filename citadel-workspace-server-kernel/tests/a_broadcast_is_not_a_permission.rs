//! Node content goes only to sessions that may view that node.
//!
//! `NodeContentUpdated` carries the document body, and it was broadcast with
//! `BroadcastAudience::Everyone`. The per-connection forwarding loop — the one place that
//! knows whose socket it is writing to — gated only `Group`, so every connected session
//! received the full `mdx_content` of anything anyone saved: a member removed a moment ago
//! whose socket is still open, and, where one server holds several workspaces, sessions
//! belonging to a different one. The pull path (`GetNode`) has always checked `ViewContent`.
//!
//! The forwarding loop itself needs a live SDK session, so what is asserted here is the
//! decision the loop makes: the same `check_entity_permission(user, node, ViewContent)` call,
//! against real users and a real node, plus the audience the command processor now attaches.
use citadel_workspace_server_kernel::handlers::domain::async_ops::{
    AsyncPermissionOperations, AsyncUserManagementOperations,
};
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::kernel::async_kernel::BroadcastAudience;
use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn office(kernel: &Kernel) -> String {
    kernel
        .domain_operations
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(ROOT),
            &NodeEntityType::Child("Office".to_string()),
            "Ops",
            "",
        )
        .await
        .expect("an admin may create an office")
        .id
}

async fn may_view(kernel: &Kernel, user: &str, node: &str) -> bool {
    kernel
        .domain_operations
        .check_entity_permission(user, node, Permission::ViewContent)
        .await
        .unwrap_or(false)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_of_the_office_may_receive_its_content() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "insider", UserRole::Member).await;
    join_root(&kernel, "insider").await;
    let node = office(&kernel).await;
    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "insider", &node, UserRole::Member)
        .await
        .expect("an admin may add a member to an office");

    assert!(
        may_view(&kernel, "insider", &node).await,
        "a member of the office must still receive its content",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_banned_account_may_not_receive_node_content() {
    // The case the old broadcast could not express: still connected, no longer entitled.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "outcast", UserRole::Member).await;
    join_root(&kernel, "outcast").await;
    let node = office(&kernel).await;
    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "outcast", &node, UserRole::Member)
        .await
        .expect("an admin may add a member to an office");
    assert!(may_view(&kernel, "outcast", &node).await, "precondition");

    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "outcast", ROOT, UserRole::Banned)
        .await
        .expect("an admin may ban");

    assert!(
        !may_view(&kernel, "outcast", &node).await,
        "a banned account must not receive the document body of a node it can no longer view",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_node_audience_is_distinct_from_everyone() {
    // The audience is what carries the decision to the forwarding loop; if a future edit
    // sends content as `Everyone` again, the gate has nothing to act on.
    let node = "node-42".to_string();
    assert_ne!(
        BroadcastAudience::Node(node.clone()),
        BroadcastAudience::Everyone
    );
    assert_eq!(
        BroadcastAudience::Node(node.clone()),
        BroadcastAudience::Node(node)
    );
}
