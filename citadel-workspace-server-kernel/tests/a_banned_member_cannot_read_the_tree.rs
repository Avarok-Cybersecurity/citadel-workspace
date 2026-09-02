//! The ban gate reached `get_workspace` and stopped there.
//!
//! Round 507 taught `get_workspace` to ask for `ViewContent`, because banning
//! changes a ROLE and leaves `workspace.members` untouched — so membership alone
//! kept admitting a banned account. Its three siblings were never told.
//!
//! `get_node`, `list_nodes` and `get_tree_structure` each asked only
//! `is_member_of_domain`, which for a workspace id is literally
//! `workspace.members.contains(user_id)`. A `DomainNode` carries `mdx_content`,
//! `members` and `children`, so `ListNodes { parent_id: None }` returned exactly
//! the content the new gate had just been added to withhold, and more of it.
//! `ListMembers` was the same shape: `is_admin || is_member`, then the complete
//! roster with every role and permission map.
//!
//! One fix, applied in one of the four places it belonged. That is the whole
//! finding — and it is why these tests read the mechanism (`ViewContent` on the
//! root) rather than the endpoint.

use citadel_workspace_server_kernel::handlers::domain::async_ops::{
    AsyncUserManagementOperations, AsyncWorkspaceOperations,
};
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

/// Every workspace-scoped read the tree exposes, asked as one answer.
async fn reads_allowed(kernel: &Kernel, user: &str) -> Vec<&'static str> {
    let mut ok = Vec::new();
    if kernel
        .domain_operations
        .get_workspace(user, ROOT)
        .await
        .is_ok()
    {
        ok.push("get_workspace");
    }
    if kernel.domain_operations.get_node(user, ROOT).await.is_ok() {
        ok.push("get_node");
    }
    if kernel
        .domain_operations
        .list_nodes(user, None, None, None)
        .await
        .is_ok()
    {
        ok.push("list_nodes");
    }
    if kernel
        .domain_operations
        .get_tree_structure(user, None, None)
        .await
        .is_ok()
    {
        ok.push("get_tree_structure");
    }
    ok
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_banned_member_cannot_read_the_tree() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "outcast", UserRole::Member).await;
    join_root(&kernel, "outcast").await;

    // Without this the test below passes on a build where every read is broken.
    assert_eq!(
        reads_allowed(&kernel, "outcast").await.len(),
        4,
        "a plain member reads all four, or the ban assertion proves nothing",
    );

    kernel
        .domain_operations
        .update_workspace_member_role(TEST_ADMIN_USER_ID, "outcast", UserRole::Banned, None)
        .await
        .expect("an admin may set a role to Banned");

    let still_open = reads_allowed(&kernel, "outcast").await;
    assert!(
        still_open.is_empty(),
        "banning left the member list untouched, so these reads still admitted them: {still_open:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_still_reads_the_tree() {
    // Guest holds ViewContent and nothing else. A gate that simply refused
    // everyone below Member would satisfy the ban case above on its own, and
    // would contradict what the permission editor shows a Guest holding.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "visitor", UserRole::Guest).await;
    join_root(&kernel, "visitor").await;

    assert_eq!(
        reads_allowed(&kernel, "visitor").await.len(),
        4,
        "ViewContent is exactly what a Guest is reported to hold",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_non_member_is_still_refused_for_being_a_non_member() {
    // The membership half of the gate must survive the permission half being
    // added — `check_entity_permission` honours a direct `permissions[root]`
    // grant before it consults membership, so ViewContent alone is not enough.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "stranger", UserRole::Member).await;
    // deliberately not joined to the root workspace

    let open = reads_allowed(&kernel, "stranger").await;
    assert!(
        open.is_empty(),
        "a non-member read the workspace tree: {open:?}",
    );
}
