//! Banning has to take away the reading, not just the role.
//!
//! `get_workspace` was gated on membership alone, and a ban leaves the member
//! list untouched. So a banned account went on reading the workspace name,
//! description, metadata and office list — everything that endpoint returns.
//!
//! The gate asks for `ViewContent` rather than testing `banned`, for the
//! reason `remove_user_from_domain` records: what `GetUserPermissions` reports
//! must be what enforcement allows. A banned account holds nothing and Guest
//! holds `ViewContent` — so the refusals and the grants below are the permission
//! editor's own answer, not a second opinion.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncWorkspaceOperations;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::roles_fixture::{GUEST_ROLE_ID, MEMBER_ROLE_ID};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn can_read(kernel: &Kernel, user: &str) -> bool {
    kernel
        .domain_operations
        .get_workspace(user, ROOT)
        .await
        .is_ok()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_banned_member_cannot_read_the_workspace() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "outcast", MEMBER_ROLE_ID).await;
    join_root(&kernel, "outcast").await;
    assert!(
        can_read(&kernel, "outcast").await,
        "a plain member reads the workspace, or this test proves nothing below",
    );

    kernel
        .domain_operations
        .ban_member(TEST_ADMIN_USER_ID, "outcast")
        .await
        .expect("an admin may ban a member");

    assert!(
        !can_read(&kernel, "outcast").await,
        "banning left the member list untouched, so membership alone still admitted them",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_still_reads_the_workspace() {
    // Guest holds ViewContent and nothing else. A gate that refused everyone
    // without a role would satisfy the ban case on its own.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "visitor", GUEST_ROLE_ID).await;
    join_root(&kernel, "visitor").await;

    assert!(
        can_read(&kernel, "visitor").await,
        "ViewContent is exactly what the permission editor shows a Guest holding",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_non_member_is_still_refused_for_being_a_non_member() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "stranger", MEMBER_ROLE_ID).await;
    // deliberately not joined to the root workspace

    assert!(
        !can_read(&kernel, "stranger").await,
        "the membership check must survive the permission check being added",
    );
}
