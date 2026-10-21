//! A workspace whose host says a link limit is none (entitlements v2's `null`, an unlimited
//! tenant) makes links past every tier's numbers, and lists that limit as `None`. The finite
//! limits beside it still bind.

use citadel_workspace_server_kernel::kernel::secure_links::quota::{Limit, LinkQuota};
use citadel_workspace_types::secure_links::{SecureLinksRequest, SecureLinksResponse};
use citadel_workspace_types::structs::UserRole;
use common::secure_links_test_utils::{
    enrol, expires, links, links_kernel_with, members, try_create, HOUR_MS,
};

/// More than any tier's own allowance and pool together.
const MANY: u32 = 120;

async fn make_many(kernel: &common::member_test_utils::GateKernel, owner: &str, n: u32) {
    for i in 0..n {
        let made = try_create(
            kernel,
            owner,
            "/messages",
            members(&["bob"]),
            expires(HOUR_MS),
        )
        .await;
        assert!(
            matches!(made, Ok(SecureLinksResponse::Created { .. })),
            "link {i}: {made:?}"
        );
    }
}

async fn listed(
    kernel: &common::member_test_utils::GateKernel,
    user: &str,
) -> (Option<u32>, Option<u32>, u32) {
    match links(kernel, user, SecureLinksRequest::List).await {
        Ok(SecureLinksResponse::Links {
            per_member,
            pool,
            pool_used,
            ..
        }) => (per_member, pool, pool_used),
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_allowance_limit_means_every_link_is_the_members_own() {
    let kernel = links_kernel_with(LinkQuota {
        per_member: Limit::Unlimited,
        pool: Limit::At(0),
    })
    .await;
    enrol(&kernel, "alice", UserRole::Member).await;
    make_many(&kernel, "alice", MANY).await;
    assert_eq!(listed(&kernel, "alice").await, (None, Some(0), 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_pool_limit_takes_every_link_past_a_finite_allowance() {
    let kernel = links_kernel_with(LinkQuota {
        per_member: Limit::At(2),
        pool: Limit::Unlimited,
    })
    .await;
    for id in ["alice", "carol"] {
        enrol(&kernel, id, UserRole::Member).await;
        make_many(&kernel, id, MANY / 2).await;
    }
    assert_eq!(listed(&kernel, "alice").await, (Some(2), None, MANY - 4));
}
