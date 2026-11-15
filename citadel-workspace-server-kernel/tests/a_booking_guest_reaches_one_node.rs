//! A booking-guest link (Calendar design §3.6.4) lets a signed-in account that is not a member
//! book on one node: resolving it lets them view that node and nowhere else, at most `max_guests`
//! accounts per link, for as long as the link lives: deleting it ends that, and so does its
//! expiry, at once and with no purge. A banned account is never admitted, and the link cannot be
//! made one-time or past the guest cap. (The purge reclaiming the record: `guest_store_tests`.)
//!
//! The real command dispatch and store; the guests are accounts whose workspace role holds no
//! permission at all, as a workspace whose default role gives joiners nothing would make them.

use citadel_workspace_types::secure_links::{SecureLinksRequest, SecureLinksResponse};
use citadel_workspace_types::structs::UserRole;
use common::booking_guest_test_utils::{booking, node, outsiders, target, views};
use common::member_test_utils::insert_user_with_role;
use common::secure_links_test_utils::{
    create, expires, links, links_kernel, one_time, opened, resolve, try_create, HOUR_MS,
};
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

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
async fn the_guest_is_refused_the_moment_the_link_expires_with_no_purge() {
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
    assert!(
        views(&kernel, "gus", &sales).await,
        "a guest while the link lives"
    );

    tokio::time::sleep(std::time::Duration::from_millis(2_000)).await;
    assert!(
        !views(&kernel, "gus", &sales).await,
        "expired, and no purge has run"
    );
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
