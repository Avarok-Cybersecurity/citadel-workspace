//! A member's own say over an install's peer-to-peer and topic capabilities (design §1, F3), and
//! the kernel's answer to "may this peer reach me" (`AppsRequest::AuthorizePeer`).
//!
//! The installer grants `ihttp.p2p.*` and `group.topic.*`; each member still allows them for
//! themselves, per install and per direction, and may block particular members of that install.
//! Without a member's consent the capability is not effective for that member, whatever the
//! grant says.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How long an `AuthorizePeer` answer may be relied on before it is asked again.
pub const PEER_AUTHORIZATION_TTL_MS: u64 = 60_000;
/// The most members one member may block on one install.
pub const MAX_BLOCKED_PEERS: usize = 256;

/// What a member allowed for one install. All three are said every time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PeerConsent {
    /// Other members' copies may run requests on this member's device (`ihttp.p2p.serve`).
    pub serve: bool,
    /// This member's copy may call other members' devices (`ihttp.p2p.call`).
    pub call: bool,
    /// This member's copy may join the app's topics (`group.topic.*`).
    pub topics: bool,
    /// When the member last said so.
    #[ts(type = "bigint")]
    pub at_ms: u64,
}

impl PeerConsent {
    /// Nothing allowed: what a member who never answered has.
    pub const NONE: PeerConsent = PeerConsent {
        serve: false,
        call: false,
        topics: false,
        at_ms: 0,
    };
}

/// One install's peer settings for the member asking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PeerForMe {
    pub install_id: String,
    pub consent: PeerConsent,
    /// Members of this install who may not reach this member, by username.
    pub blocked: Vec<String>,
}

/// What `AuthorizePeer` asks, always about the asking session and the peer at `peer_cid`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum PeerDirection {
    /// The peer opened a stream to me: may it be served? `routes_digest` is the hex sha256 of
    /// the peer-to-peer routes I serve, as `AdvertiseService` names a route table.
    Serve { routes_digest: String },
    /// May I call the peer?
    Call,
    /// May the peer join my copy's group for `topic`?
    Topic { topic: String },
}
