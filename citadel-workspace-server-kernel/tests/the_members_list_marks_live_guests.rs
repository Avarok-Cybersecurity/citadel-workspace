//! The members list marks booking guests (Calendar design §3.6.4) for whoever can manage roles,
//! so an admin can find them and remove them: an account a live booking link names is listed, at
//! the workspace too where it can view nothing, and marked a guest. The mark is derived from the
//! link records on each call: the link going, or expiring, ends it. Nobody else is told.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::secure_links::SecureLinksRequest;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::booking_guest_test_utils::{booking, node, outsiders, target};
use common::member_test_utils::GateKernel;
use common::secure_links_test_utils::{
    create, enrol, expires, links, links_kernel, resolve, HOUR_MS,
};
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

/// Who `actor` sees listed on `domain`, and which of them are marked guests.
async fn roster(kernel: &GateKernel, actor: &str, domain: &str) -> (Vec<String>, Vec<String>) {
    let request = WorkspaceProtocolRequest::ListMembers {
        domain_id: Some(domain.to_string()),
    };
    match process_command_with_user(kernel, &request, actor)
        .await
        .expect("dispatched")
    {
        WorkspaceProtocolResponse::Members {
            members, guests, ..
        } => (members.into_iter().map(|m| m.id).collect(), guests),
        other => panic!("no members: {other:?}"),
    }
}

fn names(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|s| s.to_string()).collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_sees_a_live_guest_listed_and_marked_and_a_member_is_not_told() {
    let kernel = links_kernel(50, 0).await;
    let sales = node(&kernel, "Sales").await;
    outsiders(&kernel, &["gus", "hal"]).await;
    enrol(&kernel, "mia", UserRole::Member).await;
    let (info, token) = create(
        &kernel,
        TEST_ADMIN_USER_ID,
        &target(&sales),
        booking(&sales, 5),
        expires(HOUR_MS),
    )
    .await;
    resolve(&kernel, "gus", &token).await;

    let (listed, guests) = roster(&kernel, TEST_ADMIN_USER_ID, WORKSPACE_ROOT_ID).await;
    assert_eq!(guests, names(&["gus"]));
    assert!(
        listed.contains(&"gus".to_string()),
        "a guest is listed at the workspace for an admin"
    );
    assert!(
        !listed.contains(&"hal".to_string()),
        "an outsider who is no guest is not"
    );
    assert_eq!(
        roster(&kernel, TEST_ADMIN_USER_ID, &sales).await.1,
        names(&["gus"])
    );
    let (mia_sees, mia_guests) = roster(&kernel, "mia", &sales).await;
    assert!(mia_guests.is_empty(), "a member is not told who is a guest");
    assert!(
        mia_sees.contains(&"gus".to_string()),
        "who can view the node is listed, as ever"
    );

    links(
        &kernel,
        TEST_ADMIN_USER_ID,
        SecureLinksRequest::Delete { id: info.id },
    )
    .await
    .expect("deleted");
    let (listed, guests) = roster(&kernel, TEST_ADMIN_USER_ID, WORKSPACE_ROOT_ID).await;
    assert!(guests.is_empty());
    assert!(!listed.contains(&"gus".to_string()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_mark_ends_when_the_link_expires() {
    let kernel = links_kernel(50, 0).await;
    let sales = node(&kernel, "Sales").await;
    outsiders(&kernel, &["gus"]).await;
    let (_, token) = create(
        &kernel,
        TEST_ADMIN_USER_ID,
        &target(&sales),
        booking(&sales, 5),
        expires(1_500),
    )
    .await;
    resolve(&kernel, "gus", &token).await;
    assert_eq!(
        roster(&kernel, TEST_ADMIN_USER_ID, &sales).await.1,
        names(&["gus"])
    );

    tokio::time::sleep(std::time::Duration::from_millis(2_000)).await;
    assert!(roster(&kernel, TEST_ADMIN_USER_ID, &sales)
        .await
        .1
        .is_empty());
}
