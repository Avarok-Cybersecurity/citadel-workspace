//! The manifest rules of the peer-to-peer and topic capabilities and their limits.
//!
//! - `ihttp.p2p.serve` lists routes, all of which `ihttp.serve` also lists: P2P serves a part
//!   of what the app serves, never something the relay would not.
//! - `ihttp.p2p.call` lists no targets: peer to peer, an app calls only its own copies (v1).
//! - `group.topic.*` list 1 to `MAX_TOPICS` distinct topic names.
//! - `limits.p2p` is present exactly when a P2P capability is, `limits.topics` exactly when a
//!   topic capability is, each within its ceilings.

use crate::apps::Capability;
use crate::apps_manifest::{AppLimits, CapabilityRequest};
use crate::apps_manifest_check::{distinct, ManifestRefusal};
use citadel_app_sdk_types::calls::topic::{
    is_topic_name, MAX_TOPICS, TOPIC_MAX_MSGS_PER_S_CEILING, TOPIC_MAX_MSG_BYTES_CEILING,
};

pub const MAX_FANOUT_CONCURRENCY: u32 = 32;
pub const MAX_FANOUT_BYTES: u32 = 64 * 1024 * 1024;
pub const MAX_FANOUT_MS: u32 = 300_000;
/// A P2P response is at most what any internal-HTTP response may be.
pub const MAX_P2P_RESPONSE_BYTES: u64 = citadel_ihttp_types::MAX_RESPONSE_BODY_BYTES;

pub fn takes_routes(cap: Capability) -> bool {
    matches!(cap, Capability::IhttpServe | Capability::IhttpP2pServe)
}

pub fn takes_targets(cap: Capability) -> bool {
    matches!(cap, Capability::IhttpCall | Capability::IhttpP2pCall)
}

pub fn takes_topics(cap: Capability) -> bool {
    matches!(
        cap,
        Capability::GroupTopicSubscribe | Capability::GroupTopicPublish
    )
}

pub fn is_p2p(cap: Capability) -> bool {
    matches!(cap, Capability::IhttpP2pServe | Capability::IhttpP2pCall)
}

fn refuse<T>(why: &str) -> Result<T, ManifestRefusal> {
    Err(ManifestRefusal::Capabilities(why.to_string()))
}

fn listed(requests: &[CapabilityRequest], cap: Capability) -> Option<&CapabilityRequest> {
    requests.iter().find(|r| r.cap == cap)
}

pub(crate) fn check_peer_capabilities(
    requests: &[CapabilityRequest],
) -> Result<(), ManifestRefusal> {
    if let Some(p2p) = listed(requests, Capability::IhttpP2pServe) {
        let relay = listed(requests, Capability::IhttpServe).and_then(|r| r.routes.as_ref());
        let Some(relay) = relay else {
            return refuse("ihttp.p2p.serve without ihttp.serve");
        };
        let p2p = p2p.routes.as_deref().unwrap_or_default();
        if !p2p.iter().all(|r| relay.contains(r)) {
            return refuse("ihttp.p2p.serve: a route ihttp.serve does not list");
        }
    }
    if let Some(call) = listed(requests, Capability::IhttpP2pCall) {
        if call.targets.as_ref().is_some_and(|t| !t.is_empty()) {
            return refuse("ihttp.p2p.call: targets must be empty (an app calls its own copies)");
        }
    }
    for request in requests.iter().filter(|r| takes_topics(r.cap)) {
        let topics = request.topics.as_deref().unwrap_or_default();
        let ok = (1..=MAX_TOPICS).contains(&topics.len())
            && topics.iter().all(|t| is_topic_name(t))
            && distinct(topics);
        if !ok {
            return refuse(&format!("{:?}: topics", request.cap));
        }
    }
    Ok(())
}

pub(crate) fn check_peer_limits(
    limits: &AppLimits,
    requests: &[CapabilityRequest],
) -> Result<(), ManifestRefusal> {
    let refuse = |field: &str| Err(ManifestRefusal::Limits(field.to_string()));
    let within = |value: u32, max: u32| (1..=u64::from(max)).contains(&u64::from(value));
    let asks = |f: fn(Capability) -> bool| requests.iter().any(|r| f(r.cap));
    if limits.p2p.is_some() != asks(is_p2p) {
        return refuse("p2p");
    }
    if limits.topics.is_some() != asks(takes_topics) {
        return refuse("topics");
    }
    if let Some(p2p) = &limits.p2p {
        let checks = [
            (
                "p2p.max_fanout_concurrency",
                within(p2p.max_fanout_concurrency, MAX_FANOUT_CONCURRENCY),
            ),
            (
                "p2p.max_fanout_bytes",
                within(p2p.max_fanout_bytes, MAX_FANOUT_BYTES),
            ),
            (
                "p2p.max_fanout_ms",
                within(p2p.max_fanout_ms, MAX_FANOUT_MS),
            ),
            (
                "p2p.max_response_bytes",
                p2p.max_response_bytes >= 1
                    && u64::from(p2p.max_response_bytes) <= MAX_P2P_RESPONSE_BYTES,
            ),
        ];
        if let Some((field, _)) = checks.iter().find(|(_, ok)| !ok) {
            return refuse(field);
        }
    }
    if let Some(topics) = &limits.topics {
        if !within(topics.max_msg_bytes, TOPIC_MAX_MSG_BYTES_CEILING) {
            return refuse("topics.max_msg_bytes");
        }
        if !within(topics.max_msgs_per_s, TOPIC_MAX_MSGS_PER_S_CEILING) {
            return refuse("topics.max_msgs_per_s");
        }
    }
    Ok(())
}
