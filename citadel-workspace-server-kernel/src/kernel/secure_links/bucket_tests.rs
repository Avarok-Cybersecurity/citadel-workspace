//! The expiry index is one bucket per hour: the purge walks them oldest first, a bounded number of
//! links at a time, and deletes each bucket it empties; and no stored value grows with the number
//! of links in the workspace, only with one hour's, one member's, or the pool's.

use super::records::{bucket_key, record_key, LinkRecord, EXPIRY_HOURS_KEY};
use super::test_support::{kernel_with_member, record, Kernel};
use crate::kernel::transaction::secure_links_store::LINKS_LOCK;

const HOUR: u64 = 60 * 60 * 1000;
const LINKS_PREFIX: &str = "citadel_workspace.links.";

async fn insert(kernel: &Kernel, links: &[LinkRecord]) {
    let _guard = LINKS_LOCK.lock().await;
    for link in links {
        kernel
            .domain_operations
            .backend_tx_manager
            .insert_link(link)
            .await
            .expect("insert");
    }
}

fn keys(kernel: &Kernel) -> Vec<String> {
    let entries = kernel.domain_operations.backend_tx_manager.stored_entries();
    entries.into_iter().map(|(k, _)| k).collect()
}

#[tokio::test]
async fn a_purge_walks_the_buckets_oldest_first_and_deletes_what_it_empties() {
    let kernel = kernel_with_member("alice").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    // Three expired links in each of hours 1..=10, alternating owners, every third from the pool.
    let expired: Vec<LinkRecord> = (0..30)
        .map(|n| {
            let owner = if n % 2 == 0 { "alice" } else { "bob" };
            LinkRecord {
                from_pool: n % 3 == 0,
                ..record(owner, n, (1 + n / 3) * HOUR + n)
            }
        })
        .collect();
    let live = LinkRecord {
        from_pool: true,
        ..record("alice", 99, 500 * HOUR)
    };
    insert(&kernel, &expired).await;
    insert(&kernel, std::slice::from_ref(&live)).await;
    assert_eq!(backend.link_hours().await.unwrap().len(), 11);

    let now = 100 * HOUR;
    assert_eq!(kernel.purge_expired_links(now, 7).await.unwrap(), 23);
    for gone in &expired[..7] {
        assert!(
            !keys(&kernel).contains(&record_key(&gone.digest)),
            "{} purged",
            gone.id
        );
    }
    assert!(
        keys(&kernel).contains(&record_key(&expired[7].digest)),
        "the eighth waits"
    );
    for emptied in [1, 2] {
        assert!(
            !keys(&kernel).contains(&bucket_key(emptied)),
            "hour {emptied} is deleted"
        );
    }
    assert_eq!(
        backend.link_bucket(3).await.unwrap().len(),
        2,
        "hour 3 is half done"
    );
    assert!(!backend.link_hours().await.unwrap().contains(&2));

    while kernel.purge_expired_links(now, 7).await.unwrap() > 0 {}
    assert_eq!(
        backend
            .link_hours()
            .await
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![500]
    );
    assert!(backend.link_index("bob").await.unwrap().is_empty());
    let alice = backend.link_index("alice").await.unwrap();
    assert_eq!(
        alice.iter().map(|e| e.digest.clone()).collect::<Vec<_>>(),
        vec![live.digest.clone()]
    );
    let usage = backend.link_usage("alice", now).await.unwrap();
    assert_eq!(
        usage.pool_used, 1,
        "only the live pool link still holds a place"
    );
    let link_keys: Vec<String> = keys(&kernel)
        .into_iter()
        .filter(|k| k.starts_with(LINKS_PREFIX))
        .collect();
    assert_eq!(
        link_keys.len(),
        5,
        "record, index, bucket, hours, pool: {link_keys:?}"
    );
}

/// The largest stored link value, for `n` links held by `n` members, ten to an hour, five of them
/// from the pool. The list of hours is left out: it grows with hours, not links, and links live
/// at most 30 days, so it holds at most 721.
async fn largest_value(n: u64) -> usize {
    let kernel = kernel_with_member("alice").await;
    let links: Vec<LinkRecord> = (0..n)
        .map(|i| LinkRecord {
            from_pool: i < 5,
            ..record(&format!("member-{i:05}"), i, (1_000 + i / 10) * HOUR + i)
        })
        .collect();
    insert(&kernel, &links).await;
    let entries = kernel.domain_operations.backend_tx_manager.stored_entries();
    entries
        .iter()
        .filter(|(k, _)| k.starts_with(LINKS_PREFIX) && k != EXPIRY_HOURS_KEY)
        .map(|(_, v)| v.len())
        .max()
        .expect("values")
}

#[tokio::test]
async fn no_value_grows_with_the_number_of_links_beyond_one_buckets_contents() {
    let small = largest_value(100).await;
    let large = largest_value(1_000).await;
    // Ten times the links; only the digits of a larger link number differ.
    assert!(
        large <= small + 16,
        "a value grew with the link count: {small} -> {large}"
    );
}
