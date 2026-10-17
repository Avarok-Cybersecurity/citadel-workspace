//! How many secure links a member may hold, and for how long.
//!
//! A member makes links from their own allowance first, then from the pool the workspace shares;
//! expired and spent links count against neither. A link lives at most 30 days however it is
//! extended.

use citadel_workspace_types::secure_links::{
    SecureLinksRequest, SecureLinksResponse, SECURE_LINK_MAX_TTL_MS,
};
use citadel_workspace_types::structs::UserRole;
use common::secure_links_test_utils::{
    create, enrol, expires, links, links_kernel, members, now_ms, one_time, opened, resolve,
    try_create, HOUR_MS,
};
use common::workspace_test_utils::create_test_kernel;

const TARGET: &str = "/messages";

fn limited(answer: &Result<SecureLinksResponse, String>) -> bool {
    matches!(answer, Ok(SecureLinksResponse::LimitReached { .. }))
}

async fn make(
    kernel: &common::member_test_utils::GateKernel,
    owner: &str,
) -> Result<SecureLinksResponse, String> {
    try_create(kernel, owner, TARGET, members(&["bob"]), expires(HOUR_MS)).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_holds_their_own_allowance_and_no_more_without_a_pool() {
    for per_member in [5, 50] {
        let kernel = links_kernel(per_member, 0).await;
        enrol(&kernel, "alice", UserRole::Member).await;
        for n in 0..per_member {
            assert!(
                matches!(
                    make(&kernel, "alice").await,
                    Ok(SecureLinksResponse::Created { .. })
                ),
                "link {n}"
            );
        }
        assert_eq!(
            make(&kernel, "alice").await,
            Ok(SecureLinksResponse::LimitReached {
                per_member,
                pool: 0
            })
        );
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
async fn expired_and_spent_links_free_their_place() {
    let kernel = links_kernel(2, 0).await;
    for id in ["alice", "bob"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    let (_, spent) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        one_time(HOUR_MS),
    )
    .await;
    create(&kernel, "alice", TARGET, members(&["bob"]), expires(300)).await;
    assert!(limited(&make(&kernel, "alice").await));
    assert!(opened(&resolve(&kernel, "bob", &spent).await, TARGET));
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    for _ in 0..2 {
        assert!(
            !limited(&make(&kernel, "alice").await),
            "both places are free again"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_link_lives_at_most_thirty_days_however_it_is_extended() {
    let kernel = links_kernel(5, 0).await;
    for id in ["alice", "bob"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    let before = now_ms();
    let (info, _) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        expires(90 * 24 * HOUR_MS),
    )
    .await;
    assert!(
        info.expires_ms <= now_ms() + SECURE_LINK_MAX_TTL_MS
            && info.expires_ms >= before + SECURE_LINK_MAX_TTL_MS
    );

    let extend = |user: &'static str, ttl_ms: u64| {
        links(
            &kernel,
            user,
            SecureLinksRequest::Extend {
                id: info.id.clone(),
                ttl_ms,
            },
        )
    };
    assert_eq!(
        extend("bob", HOUR_MS).await,
        Ok(SecureLinksResponse::LinkUnavailable),
        "not bob's"
    );
    let before = now_ms();
    match extend("alice", 365 * 24 * HOUR_MS).await {
        Ok(SecureLinksResponse::Extended { info }) => {
            assert!(info.expires_ms >= before + SECURE_LINK_MAX_TTL_MS);
            assert!(
                info.expires_ms <= now_ms() + SECURE_LINK_MAX_TTL_MS,
                "capped at thirty days"
            );
        }
        other => panic!("{other:?}"),
    }
    match extend("alice", HOUR_MS).await {
        Ok(SecureLinksResponse::Extended { info }) => {
            assert!(info.expires_ms <= now_ms() + HOUR_MS)
        }
        other => panic!("an extension may also shorten: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_with_no_limit_makes_no_links() {
    let kernel = create_test_kernel().await;
    enrol(&kernel, "alice", UserRole::Member).await;
    let answer = make(&kernel, "alice").await;
    assert!(
        matches!(&answer, Err(text) if text.contains("no secure-link limit")),
        "{answer:?}"
    );
}
