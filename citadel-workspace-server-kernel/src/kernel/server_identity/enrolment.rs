//! The second gate (identity doc §6 rev b): first-connect enrolment refuses an account named
//! under a domain this server does not answer to, the way it refuses a removed member. The
//! admission policy already refuses such a registration; this catches an account that reached
//! the store another way (an older kernel, an imported backend). Pure.
//!
//! Legacy (bare) names keep enrolling: nothing is re-keyed, and they keep working unchanged.

use citadel_identity::{parse_username, CanonicalDomain, Username};

/// Why `username` may not be enrolled here, or `None` when it may.
pub fn enrolment_refusal(username: &str, accepted: &[CanonicalDomain]) -> Option<String> {
    match parse_username(username) {
        Ok(Username::Legacy(_)) => None,
        Ok(Username::V2 { domain, .. }) if accepted.iter().any(|d| d.as_str() == domain) => None,
        Ok(Username::V2 { domain, .. }) => Some(format!(
            "{username} is named under {domain:?}, which is not a domain of this server"
        )),
        Err(why) => Some(format!(
            "{username:?} is not a username this server enrols: {why}"
        )),
    }
}

/// The name other members see for an account with no registered full name: the handle of a
/// `handle@domain` account, the whole name of a legacy one.
pub fn fallback_display_name(username: &str) -> &str {
    match parse_username(username) {
        Ok(Username::V2 { handle, .. }) => handle,
        _ => username,
    }
}
