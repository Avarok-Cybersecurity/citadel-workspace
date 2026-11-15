//! Booking guests (Calendar design §3.6.4), pure: whether a visitor who is not a member is
//! admitted by a link's `BookingGuest` grant, and what taking a link away gives back.
//!
//! A guest is an account in good standing that holds no `ViewContent` on the workspace. A link
//! admits at most its `max_guests` of them per node, each once: an account it admitted before is
//! admitted again without counting twice. Every account it admits is recorded on the link, with
//! whether the link is what gave it `ViewContent` on the node, so removing the link takes back
//! exactly what the link gave.

use super::records::GuestGrant;
use citadel_workspace_types::secure_links::LinkGrant;

/// What the kernel knows of a visitor that is not a member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuestCandidate<'a> {
    pub user_id: &'a str,
    /// An account the workspace knows, not banned, holding no `ViewContent` on the workspace.
    pub eligible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuestVerdict {
    /// No booking-guest grant admits them.
    Refused,
    /// Admitted before, to this node: nothing to grant or record.
    Returning { node: String },
    /// Admitted now: grant `ViewContent` on `node` and record them.
    New { node: String },
}

/// The first booking-guest grant that admits `visitor`, given who the link admitted so far.
pub fn guest_verdict(
    grants: &[LinkGrant],
    guests: &[GuestGrant],
    visitor: &GuestCandidate<'_>,
) -> GuestVerdict {
    if !visitor.eligible {
        return GuestVerdict::Refused;
    }
    for grant in grants {
        let LinkGrant::BookingGuest {
            node_id,
            max_guests,
            ..
        } = grant
        else {
            continue;
        };
        let on_node = guests.iter().filter(|g| &g.node == node_id);
        if on_node.clone().any(|g| g.user == visitor.user_id) {
            return GuestVerdict::Returning {
                node: node_id.clone(),
            };
        }
        if on_node.count() < usize::from(*max_guests) {
            return GuestVerdict::New {
                node: node_id.clone(),
            };
        }
    }
    GuestVerdict::Refused
}

/// The `(user, node)` grants to take back when a link goes: only those the link gave.
pub fn grants_to_revoke(guests: &[GuestGrant]) -> Vec<(&str, &str)> {
    guests
        .iter()
        .filter(|g| g.granted)
        .map(|g| (g.user.as_str(), g.node.as_str()))
        .collect()
}
