//! `guests`: a booking-guest grant admits an eligible account up to its `max_guests` per node,
//! an account it admitted before without counting it twice, and nobody who is not eligible; a
//! link going takes back only the grants it gave.

use super::guests::*;
use super::records::GuestGrant;
use citadel_workspace_types::secure_links::LinkGrant;

fn booking(node: &str, max_guests: u8) -> LinkGrant {
    LinkGrant::BookingGuest {
        node_id: node.to_string(),
        page: "ana".to_string(),
        max_guests,
    }
}

fn guest(user: &str, node: &str, granted: bool) -> GuestGrant {
    GuestGrant {
        user: user.to_string(),
        node: node.to_string(),
        granted,
    }
}

fn visitor(user_id: &str, eligible: bool) -> GuestCandidate<'_> {
    GuestCandidate { user_id, eligible }
}

#[test]
fn admits_up_to_the_cap_and_a_returning_guest_without_counting_twice() {
    let grants = [booking("n1", 2)];
    let one = [guest("gus", "n1", true)];
    let two = [guest("gus", "n1", true), guest("hal", "n1", true)];
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
    let full_n1 = [guest("gus", "n1", true)];
    assert_eq!(
        guest_verdict(&grants, &full_n1, &visitor("hal", true)),
        GuestVerdict::New { node: "n2".into() }
    );
}

#[test]
fn a_link_takes_back_only_what_it_gave() {
    let guests = [guest("gus", "n1", true), guest("hal", "n1", false)];
    assert_eq!(grants_to_revoke(&guests), [("gus", "n1")]);
}
