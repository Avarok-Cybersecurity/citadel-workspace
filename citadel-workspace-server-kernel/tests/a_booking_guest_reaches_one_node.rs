//! A booking-guest link (Calendar design §3.6.4) lets a signed-in account that is not a member
//! book on one node: resolving it gives them `ViewContent` on that node and nowhere else, at most
//! `max_guests` accounts per link, and deleting the link or its expiry takes the grant back. A
//! banned account is never admitted, and the link cannot be made one-time or past the guest cap.
//!
//! The real command dispatch and store; the guests are accounts whose workspace role holds no
//! permission at all, as a workspace whose default role gives joiners nothing would make them.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::secure_links::{LinkGrant, SecureLinksRequest, SecureLinksResponse};
use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, member_holding, seed_role, GateKernel};
use common::secure_links_test_utils::{
    create, expires, links, links_kernel, now_ms, one_time, opened, resolve, try_create, HOUR_MS,
};
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

async fn node(kernel: &GateKernel, name: &str) -> String {
    let request = WorkspaceProtocolRequest::CreateNode {
        parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        name: name.to_string(),
        description: String::new(),
        metadata: None,
    };
    match process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatched")
    {
        WorkspaceProtocolResponse::Node(node) => node.id,
        other => panic!("no node: {other:?}"),
    }
}

/// Accounts the workspace knows whose role holds nothing: not members.
async fn outsiders(kernel: &GateKernel, ids: &[&str]) {
    seed_role(kernel, "nothing", 10, &[]).await;
    for id in ids {
        member_holding(kernel, id, "nothing").await;
    }
}

async fn views(kernel: &GateKernel, user: &str, node: &str) -> bool {
    kernel
        .domain_operations
        .check_entity_permission(user, node, Permission::ViewContent)
        .await
        .expect("checked")
}

fn booking(node: &str, max_guests: u8) -> Vec<LinkGrant> {
    vec![LinkGrant::BookingGuest {
        node_id: node.to_string(),
        page: "admin".to_string(),
        max_guests,
    }]
}

fn target(node: &str) -> String {
    format!("/workspace?nodeId={node}")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_views_the_one_node_and_the_cap_holds() {
    let kernel = links_kernel(50, 0).await;
    let (sales, hr) = (node(&kernel, "Sales").await, node(&kernel, "HR").await);
    outsiders(&kernel, &["gus", "hal"]).await;
    assert!(
        !views(&kernel, "gus", &sales).await,
        "an outsider sees nothing before the link"
    );
    let (_, token) = create(
        &kernel,
        TEST_ADMIN_USER_ID,
        &target(&sales),
        booking(&sales, 1),
        expires(HOUR_MS),
    )
    .await;

    assert!(opened(
        &resolve(&kernel, "gus", &token).await,
        &target(&sales)
    ));
    assert!(views(&kernel, "gus", &sales).await);
    assert!(
        !views(&kernel, "gus", &hr).await,
        "a guest reaches one node only"
    );
    assert!(
        opened(&resolve(&kernel, "gus", &token).await, &target(&sales)),
        "a returning guest is not counted twice"
    );
    assert_eq!(
        resolve(&kernel, "hal", &token).await,
        SecureLinksResponse::LinkUnavailable,
        "past max_guests"
    );
    assert!(!views(&kernel, "hal", &sales).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_the_link_takes_the_grant_back() {
    let kernel = links_kernel(50, 0).await;
    let sales = node(&kernel, "Sales").await;
    outsiders(&kernel, &["gus"]).await;
    let (info, token) = create(
        &kernel,
        TEST_ADMIN_USER_ID,
        &target(&sales),
        booking(&sales, 5),
        expires(HOUR_MS),
    )
    .await;
    resolve(&kernel, "gus", &token).await;
    assert!(views(&kernel, "gus", &sales).await);

    let deleted = links(
        &kernel,
        TEST_ADMIN_USER_ID,
        SecureLinksRequest::Delete { id: info.id },
    )
    .await
    .expect("deleted");
    assert!(matches!(deleted, SecureLinksResponse::Deleted { .. }));
    assert!(
        !views(&kernel, "gus", &sales).await,
        "the link's grant went with it"
    );
    assert_eq!(
        resolve(&kernel, "gus", &token).await,
        SecureLinksResponse::LinkUnavailable
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_purge_of_an_expired_link_takes_the_grant_back() {
    let kernel = links_kernel(50, 0).await;
    let sales = node(&kernel, "Sales").await;
    outsiders(&kernel, &["gus"]).await;
    let (_, token) = create(
        &kernel,
        TEST_ADMIN_USER_ID,
        &target(&sales),
        booking(&sales, 5),
        expires(HOUR_MS),
    )
    .await;
    resolve(&kernel, "gus", &token).await;
    assert!(views(&kernel, "gus", &sales).await);

    kernel
        .purge_expired_links(now_ms() + 2 * HOUR_MS, 200)
        .await
        .expect("purged");
    assert!(!views(&kernel, "gus", &sales).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_banned_or_unknown_account_is_never_a_guest() {
    let kernel = links_kernel(50, 0).await;
    let sales = node(&kernel, "Sales").await;
    insert_user_with_role(&kernel, "barred", UserRole::Banned).await;
    let (_, token) = create(
        &kernel,
        TEST_ADMIN_USER_ID,
        &target(&sales),
        booking(&sales, 5),
        expires(HOUR_MS),
    )
    .await;
    assert_eq!(
        resolve(&kernel, "barred", &token).await,
        SecureLinksResponse::LinkUnavailable
    );
    assert_eq!(
        resolve(&kernel, "stranger", &token).await,
        SecureLinksResponse::LinkUnavailable,
        "no account"
    );
    assert!(!views(&kernel, "barred", &sales).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_booking_link_is_never_one_time_and_names_1_to_50_guests() {
    let kernel = links_kernel(50, 0).await;
    let sales = node(&kernel, "Sales").await;
    let to = target(&sales);
    let admin = TEST_ADMIN_USER_ID;
    assert!(
        try_create(&kernel, admin, &to, booking(&sales, 5), one_time(HOUR_MS))
            .await
            .is_err()
    );
    assert!(
        try_create(&kernel, admin, &to, booking(&sales, 0), expires(HOUR_MS))
            .await
            .is_err()
    );
    assert!(
        try_create(&kernel, admin, &to, booking(&sales, 51), expires(HOUR_MS))
            .await
            .is_err()
    );
    let unseen = booking("no-such-node", 5);
    assert!(
        try_create(&kernel, admin, &to, unseen, expires(HOUR_MS))
            .await
            .is_err(),
        "no grant to a node its creator cannot see"
    );
    assert!(
        try_create(&kernel, admin, &to, booking(&sales, 50), expires(HOUR_MS))
            .await
            .is_ok()
    );
}
