//! The manifest rules of `citadel.session` (citadel-session-abi §2) and its limits.
//!
//! - `servers` is present exactly for `citadel.session`: 1 to `MAX_SESSION_SERVERS` distinct
//!   entries, each already a canonical domain (identity-api §3: `canonical_domain(s) == s`), so
//!   the consent screen, the grant and the agent name a server one way.
//! - `limits.session` is present exactly when `citadel.session` is asked for, within the SDK's
//!   ceilings, as `limits.topics` is for the topic capabilities.

use crate::apps::Capability;
use crate::apps_manifest::{AppLimits, CapabilityRequest};
use crate::apps_manifest_check::{distinct, ManifestRefusal};
use citadel_app_sdk_types::calls::session::{
    MAX_SESSION_SERVERS, SESSION_MAX_MSGS_PER_S_CEILING, SESSION_MAX_MSG_BYTES_CEILING,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What the app may send on its sessions: the host refuses past these (`session_bytes`,
/// `session_rate`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct SessionLimits {
    /// 1 to `SESSION_MAX_MSG_BYTES_CEILING`.
    pub max_msg_bytes: u32,
    /// 1 to `SESSION_MAX_MSGS_PER_S_CEILING`; the token bucket's burst too.
    pub max_msgs_per_s: u32,
}

pub fn takes_servers(cap: Capability) -> bool {
    cap == Capability::CitadelSession
}

/// Whether `server` is a canonical domain: what `canonical_domain` makes of it is itself.
pub fn is_canonical_server(server: &str) -> bool {
    citadel_identity::canonical_domain(server).is_ok_and(|domain| domain.as_str() == server)
}

pub(crate) fn check_session_capabilities(
    requests: &[CapabilityRequest],
) -> Result<(), ManifestRefusal> {
    let refuse = |why: String| Err(ManifestRefusal::Capabilities(why));
    for request in requests {
        let cap = request.cap;
        if request.servers.is_some() != takes_servers(cap) {
            return refuse(format!("{cap:?}: servers where they do not belong"));
        }
        if let Some(servers) = &request.servers {
            let ok = (1..=MAX_SESSION_SERVERS).contains(&servers.len())
                && servers.iter().all(|s| is_canonical_server(s))
                && distinct(servers);
            if !ok {
                return refuse(format!("{cap:?}: servers"));
            }
        }
    }
    Ok(())
}

pub(crate) fn check_session_limits(
    limits: &AppLimits,
    requests: &[CapabilityRequest],
) -> Result<(), ManifestRefusal> {
    let refuse = |field: &str| Err(ManifestRefusal::Limits(field.to_string()));
    let within = |value: u32, max: u32| (1..=max).contains(&value);
    if limits.session.is_some() != requests.iter().any(|r| takes_servers(r.cap)) {
        return refuse("session");
    }
    if let Some(session) = &limits.session {
        if !within(session.max_msg_bytes, SESSION_MAX_MSG_BYTES_CEILING) {
            return refuse("session.max_msg_bytes");
        }
        if !within(session.max_msgs_per_s, SESSION_MAX_MSGS_PER_S_CEILING) {
            return refuse("session.max_msgs_per_s");
        }
    }
    Ok(())
}
