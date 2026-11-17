//! The booking-guest listing beside the link store: a link with a booking grant is listed when
//! stored and unlisted when removed or purged, and who is a guest is read from the live records,
//! so a link's guests stop being guests at its expiry, before any purge.

use super::records::{GuestGrant, LinkRecord};
use super::test_support::{kernel_with_member, record};
use citadel_workspace_types::secure_links::LinkGrant;
use std::collections::BTreeSet;

fn booking_link(n: u64, expires_ms: u64, guests: &[(&str, &str)]) -> LinkRecord {
    LinkRecord {
        grants: vec![LinkGrant::BookingGuest {
            node_id: "n1".to_string(),
            page: "ana".to_string(),
            max_guests: 5,
        }],
        guests: guests
            .iter()
            .map(|(user, node)| GuestGrant {
                user: user.to_string(),
                node: node.to_string(),
            })
            .collect(),
        ..record("ana", n, expires_ms)
    }
}

fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[tokio::test]
async fn only_a_booking_link_is_listed_and_its_guests_last_until_its_expiry() {
    let kernel = kernel_with_member("ana").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let booking = booking_link(1, 100, &[("gus", "n1")]);
    backend.insert_link(&booking).await.expect("insert");
    backend
        .insert_link(&record("ana", 2, 100))
        .await
        .expect("insert");

    assert_eq!(
        backend.booking_link_digests().await.expect("read"),
        set(&[&booking.digest])
    );
    assert_eq!(
        backend.live_guest_users(99).await.expect("read"),
        set(&["gus"])
    );
    assert_eq!(
        backend.live_guest_nodes("gus", 99).await.expect("read"),
        set(&["n1"])
    );
    assert!(
        backend
            .live_guest_users(100)
            .await
            .expect("read")
            .is_empty(),
        "expired, unpurged"
    );
    assert!(backend
        .live_guest_nodes("gus", 100)
        .await
        .expect("read")
        .is_empty());
}

#[tokio::test]
async fn the_purge_reclaims_an_expired_booking_link_and_its_listing() {
    let kernel = kernel_with_member("ana").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let booking = booking_link(1, 100, &[("gus", "n1")]);
    backend.insert_link(&booking).await.expect("insert");

    backend.purge_expired_links(200, 10).await.expect("purge");
    assert!(backend
        .link_by_digest(&booking.digest)
        .await
        .expect("read")
        .is_none());
    assert!(backend
        .booking_link_digests()
        .await
        .expect("read")
        .is_empty());
}

#[tokio::test]
async fn removing_a_booking_link_unlists_it() {
    let kernel = kernel_with_member("ana").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let booking = booking_link(1, 100, &[("gus", "n1")]);
    backend.insert_link(&booking).await.expect("insert");

    backend.remove_link(&booking).await.expect("remove");
    assert!(backend
        .booking_link_digests()
        .await
        .expect("read")
        .is_empty());
    assert!(backend.live_guest_users(0).await.expect("read").is_empty());
}
