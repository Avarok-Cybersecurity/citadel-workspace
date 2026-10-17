//! A member makes links from their own allowance first, then from the one pool the workspace
//! shares. Each link keeps the source it was made from: a pool link that ends frees a place in
//! the pool, and an own link that ends frees one of its owner's, never the pool's.

use citadel_workspace_types::secure_links::{SecureLinksRequest, SecureLinksResponse};
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::GateKernel;
use common::secure_links_test_utils::{
    create, enrol, expires, links, links_kernel, members, one_time, opened, resolve, try_create,
    HOUR_MS,
};

const TARGET: &str = "/messages";

fn limited(answer: &Result<SecureLinksResponse, String>) -> bool {
    matches!(answer, Ok(SecureLinksResponse::LimitReached { .. }))
}

async fn make(kernel: &GateKernel, owner: &str) -> Result<SecureLinksResponse, String> {
    try_create(kernel, owner, TARGET, members(&["bob"]), expires(HOUR_MS)).await
}

async fn pool_used(kernel: &GateKernel, user: &str) -> u32 {
    match links(kernel, user, SecureLinksRequest::List).await {
        Ok(SecureLinksResponse::Links { pool_used, .. }) => pool_used,
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn past_their_own_members_share_one_pool() {
    let kernel = links_kernel(2, 3).await;
    for id in ["alice", "bob", "carol"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    // Alice uses her own two, then two of the pool's three.
    for _ in 0..4 {
        assert!(!limited(&make(&kernel, "alice").await));
    }
    // Bob's own come first: his two do not touch the pool, his third takes its last place.
    for _ in 0..3 {
        assert!(!limited(&make(&kernel, "bob").await));
    }
    assert!(limited(&make(&kernel, "bob").await), "the pool is full");
    assert!(limited(&make(&kernel, "alice").await), "for everyone");
    // Carol has drawn nothing: her own allowance is hers whatever the pool holds.
    for _ in 0..2 {
        assert!(!limited(&make(&kernel, "carol").await));
    }
    assert!(limited(&make(&kernel, "carol").await));

    match links(&kernel, "alice", SecureLinksRequest::List).await {
        Ok(SecureLinksResponse::Links {
            links,
            live,
            per_member,
            pool,
            pool_used,
        }) => {
            assert_eq!(
                (links.len(), live, per_member, pool, pool_used),
                (4, 4, 2, 3, 3)
            );
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_pool_link_deleted_spent_or_expired_frees_its_place() {
    let kernel = links_kernel(1, 1).await;
    for id in ["alice", "bob"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;

    // Deleted.
    let (pooled, _) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;
    assert_eq!(pool_used(&kernel, "alice").await, 1);
    assert!(limited(&make(&kernel, "alice").await));
    let deleted = links(
        &kernel,
        "alice",
        SecureLinksRequest::Delete { id: pooled.id },
    )
    .await;
    assert!(matches!(deleted, Ok(SecureLinksResponse::Deleted { .. })));
    assert_eq!(pool_used(&kernel, "alice").await, 0);

    // Spent.
    let (_, token) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        one_time(HOUR_MS),
    )
    .await;
    assert_eq!(pool_used(&kernel, "alice").await, 1);
    assert!(opened(&resolve(&kernel, "bob", &token).await, TARGET));
    assert_eq!(pool_used(&kernel, "alice").await, 0);

    // Expired.
    create(&kernel, "alice", TARGET, members(&["bob"]), expires(300)).await;
    assert_eq!(pool_used(&kernel, "alice").await, 1);
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    assert_eq!(pool_used(&kernel, "alice").await, 0);
    assert!(
        !limited(&make(&kernel, "alice").await),
        "the pool's place is free again"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_own_link_expiring_does_not_turn_a_pool_link_into_an_own_one() {
    let kernel = links_kernel(1, 1).await;
    for id in ["alice", "bob"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    create(&kernel, "alice", TARGET, members(&["bob"]), expires(300)).await;
    create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;

    // Alice's own link is gone; her other one still holds the pool's only place.
    assert_eq!(pool_used(&kernel, "bob").await, 1);
    assert!(!limited(&make(&kernel, "bob").await), "bob's own allowance");
    assert!(
        limited(&make(&kernel, "bob").await),
        "and the pool is still alice's"
    );
    assert!(
        !limited(&make(&kernel, "alice").await),
        "alice's own place is free"
    );
    assert!(limited(&make(&kernel, "alice").await));
}
