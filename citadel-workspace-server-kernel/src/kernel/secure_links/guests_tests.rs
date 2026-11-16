//! `guests`: a booking-guest grant admits an eligible account up to its `max_guests` per node,
//! an account it admitted before without counting it twice, and nobody who is not eligible; a
//! guest views their node, and what is below it, only while a live link names them.

use super::guests::*;
use super::records::{GuestGrant, LinkRecord};
use super::test_support::record;
use citadel_workspace_types::secure_links::LinkGrant;

fn booking(node: &str, max_guests: u8) -> LinkGrant {
    LinkGrant::BookingGuest {
        node_id: node.to_string(),
        page: "ana".to_string(),
        max_guests,
    }
}

fn guest(user: &str, node: &str) -> GuestGrant {
    GuestGrant {
        user: user.to_string(),
        node: node.to_string(),
    }
}

fn link(n: u64, expires_ms: u64, guests: Vec<GuestGrant>) -> LinkRecord {
    LinkRecord {
        guests,
        ..record("ana", n, expires_ms)
    }
}

fn visitor(user_id: &str, eligible: bool) -> GuestCandidate<'_> {
    GuestCandidate { user_id, eligible }
}

#[test]
fn admits_up_to_the_cap_and_a_returning_guest_without_counting_twice() {
    let grants = [booking("n1", 2)];
    let one = [guest("gus", "n1")];
    let two = [guest("gus", "n1"), guest("hal", "n1")];
    let new = GuestVerdict::New { node: "n1".into() };
    assert_eq!(guest_verdict(&grants, &[], &visitor("gus", true)), new);
    assert_eq!(guest_verdict(&grants, &one, &visitor("hal", true)), new);
    assert_eq!(
        guest_verdict(&grants, &two, &visitor("ivy", true)),
        GuestVerdict::Refused
    );
    assert_eq!(
        guest_verdict(&grants, &two, &visitor("gus", true)),
        GuestVerdict::Returning { node: "n1".into() }
    );
}

#[test]
fn refuses_an_ineligible_account_and_a_link_without_a_booking_grant() {
    assert_eq!(
        guest_verdict(&[booking("n1", 5)], &[], &visitor("gus", false)),
        GuestVerdict::Refused
    );
    assert_eq!(
        guest_verdict(&[LinkGrant::Workspace], &[], &visitor("gus", true)),
        GuestVerdict::Refused
    );
}

#[test]
fn the_cap_is_per_node() {
    let grants = [booking("n1", 1), booking("n2", 1)];
    let full_n1 = [guest("gus", "n1")];
    assert_eq!(
        guest_verdict(&grants, &full_n1, &visitor("hal", true)),
        GuestVerdict::New { node: "n2".into() }
    );
}

#[test]
fn a_guest_views_only_what_a_live_link_names_them_for() {
    let links = [
        link(1, 100, vec![guest("gus", "n1"), guest("hal", "n1")]),
        link(2, 50, vec![guest("gus", "n2")]),
    ];
    assert_eq!(guest_nodes(&links, "gus", 49), ["n1", "n2"].into());
    assert_eq!(
        guest_nodes(&links, "gus", 50),
        ["n1"].into(),
        "expired at its expiry"
    );
    assert!(guest_nodes(&links, "ivy", 0).is_empty());
    assert_eq!(live_guests(&links, 99), ["gus", "hal"].into());
    assert!(live_guests(&links, 100).is_empty());
}

#[test]
fn a_guest_of_a_node_sees_below_it_and_not_above() {
    let nodes = ["n1"].into();
    assert!(covers(&nodes, &["n1", "ws"]));
    assert!(covers(&nodes, &["room", "n1", "ws"]));
    assert!(!covers(&nodes, &["n2", "ws"]));
    assert!(!covers(&nodes, &["ws"]));
}
