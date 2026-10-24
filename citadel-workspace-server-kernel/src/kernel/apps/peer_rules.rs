//! Peer-to-peer and topic authority, pure (design §1, check #5): which capabilities a member's
//! own consent leaves effective, and whether two members of one install may reach each other.
//! Every "no" is the same answer, so the caller learns nothing about which check failed.

use citadel_workspace_types::apps::peer::{PeerConsent, PeerDirection};
use citadel_workspace_types::apps::Capability;
use std::collections::BTreeSet;

/// The capabilities a member must allow for themselves, beyond the install's grant.
pub fn consent_gated(cap: Capability) -> bool {
    matches!(
        cap,
        Capability::IhttpP2pServe
            | Capability::IhttpP2pCall
            | Capability::GroupTopicSubscribe
            | Capability::GroupTopicPublish
    )
}

/// Whether `consent` allows `cap` (a capability that is not consent-gated is always allowed).
pub fn allows(consent: &PeerConsent, cap: Capability) -> bool {
    match cap {
        Capability::IhttpP2pServe => consent.serve,
        Capability::IhttpP2pCall => consent.call,
        Capability::GroupTopicSubscribe | Capability::GroupTopicPublish => consent.topics,
        _ => true,
    }
}

/// `effective`, less every consent-gated capability the member did not allow; all of them when
/// the member disabled the install for themselves.
pub fn with_consent(
    effective: BTreeSet<Capability>,
    consent: &PeerConsent,
    disabled: bool,
) -> BTreeSet<Capability> {
    effective
        .into_iter()
        .filter(|c| !consent_gated(*c) || (!disabled && allows(consent, *c)))
        .collect()
}

/// One end of a peer question, as the kernel found it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Side {
    pub username: String,
    /// Inside the install's audience and scope.
    pub reached: bool,
    /// Effective for this member, consent applied (`with_consent`).
    pub effective: BTreeSet<Capability>,
    /// The members of this install this member blocked.
    pub blocked: BTreeSet<String>,
}

/// Everything `AuthorizePeer` decides on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerQuestion {
    pub active: bool,
    pub asker: Side,
    pub peer: Side,
    /// The install's consented peer-to-peer routes' digest.
    pub p2p_routes_digest: String,
    /// The install's topics.
    pub topics: Vec<String>,
}

fn holds_topic(side: &Side) -> bool {
    side.effective.contains(&Capability::GroupTopicSubscribe)
        || side.effective.contains(&Capability::GroupTopicPublish)
}

/// Whether the peer may reach the asker (`Serve`, `Topic`) or be reached by it (`Call`).
pub fn authorized(q: &PeerQuestion, direction: &PeerDirection) -> bool {
    let (asker, peer) = (&q.asker, &q.peer);
    let common = q.active
        && asker.username != peer.username
        && asker.reached
        && peer.reached
        && !asker.blocked.contains(&peer.username)
        && !peer.blocked.contains(&asker.username);
    common
        && match direction {
            PeerDirection::Serve { routes_digest } => {
                asker.effective.contains(&Capability::IhttpP2pServe)
                    && peer.effective.contains(&Capability::IhttpP2pCall)
                    && *routes_digest == q.p2p_routes_digest
            }
            PeerDirection::Call => {
                asker.effective.contains(&Capability::IhttpP2pCall)
                    && peer.effective.contains(&Capability::IhttpP2pServe)
            }
            PeerDirection::Topic { topic } => {
                q.topics.contains(topic) && holds_topic(asker) && holds_topic(peer)
            }
        }
}
