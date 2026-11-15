//! Booking guests (Calendar design §3.6.4), pure: whether a visitor who is not a member is
//! admitted by a link's `BookingGuest` grant, and what the live links say a guest may view.
//!
//! A guest is an account in good standing that holds no `ViewContent` on the workspace. A link
//! admits at most its `max_guests` of them per node, each once: an account it admitted before is
//! admitted again without counting twice. Every account it admits is recorded on the link, and
//! that record is the grant: a guest views a node while a live link names them for it, so the
//! link expiring ends it at that moment and the purge only reclaims the space.

use super::records::{GuestGrant, LinkRecord};
use citadel_workspace_types::secure_links::LinkGrant;
use std::collections::BTreeSet;

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

/// The nodes `user` is a guest of at `now_ms`: those a live link names them for.
pub fn guest_nodes<'a>(links: &'a [LinkRecord], user: &str, now_ms: u64) -> BTreeSet<&'a str> {
    links
        .iter()
        .filter(|link| link.live_at(now_ms))
        .flat_map(|link| link.guests.iter())
        .filter(|g| g.user == user)
        .map(|g| g.node.as_str())
        .collect()
}

/// Every account a live link names as a guest at `now_ms`.
pub fn live_guests(links: &[LinkRecord], now_ms: u64) -> BTreeSet<&str> {
    links
        .iter()
        .filter(|link| link.live_at(now_ms))
        .flat_map(|link| link.guests.iter())
        .map(|g| g.user.as_str())
        .collect()
}

/// Whether a guest of `nodes` may view the entity whose path, itself first and then each level
/// above, is `chain`: a guest of a node sees what is below it, as a direct grant there would.
pub fn covers(nodes: &BTreeSet<&str>, chain: &[&str]) -> bool {
    chain.iter().any(|id| nodes.contains(id))
}
