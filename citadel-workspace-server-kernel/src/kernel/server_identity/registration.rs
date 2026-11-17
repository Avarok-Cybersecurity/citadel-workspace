//! Which names may be registered here (identity doc §6 rules 1-3 rev b). Pure: the reservation
//! lookups are the caller's (`sign_in::name_policy`).
//!
//! 1. Every registration is `handle@<canonical_domain>`. A bare name, another domain or a former
//!    domain is refused with `citadel-identity-v1 canonical=<canonical>`, the wire string an
//!    agent reads to re-derive the name under the canonical domain.
//! 2. The handle is 3..=64 bytes of `[a-z0-9._-]`, no leading/trailing `.`, no `..`; the whole
//!    name is at most `citadel_identity::MAX_USERNAME_BYTES`.
//! 3. A handle is reserved when the bare handle (a legacy account) or the handle under any of
//!    this server's domains is already an account, so `alice` and `alice@d` never both exist.

use super::config::IdentityPlan;
use citadel_identity::{make_username, parse_username, Username};

/// The refusal an agent re-derives from (`AdmissionRefusal::Failed`), before the domain.
pub const CANONICAL_REFUSAL_PREFIX: &str = "citadel-identity-v1 canonical=";

/// `citadel-identity-v1 canonical=<canonical>`.
pub fn canonical_refusal(plan: &IdentityPlan) -> String {
    format!("{CANONICAL_REFUSAL_PREFIX}{}", plan.canonical)
}

/// A name that passed rules 1 and 2: its handle, and every account name that would reserve it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub handle: String,
    /// The bare handle, then `handle@<domain>` for the canonical and every former domain.
    pub reserving_names: Vec<String>,
}

/// Rules 1 and 2 for registering `username`, or the reason it is refused.
pub fn registration_candidate(username: &str, plan: &IdentityPlan) -> Result<Candidate, String> {
    let parsed =
        parse_username(username).map_err(|why| format!("the username is refused: {why}"))?;
    let handle = match parsed {
        Username::V2 { handle, domain } if domain == plan.canonical.as_str() => handle,
        Username::V2 { .. } | Username::Legacy(_) => return Err(canonical_refusal(plan)),
    };
    let mut reserving_names = vec![handle.to_string()];
    // A handle too long to sit under some domain cannot have been registered under it, so that
    // name reserves nothing; the canonical one was just parsed, so it is always listed.
    reserving_names.extend(
        plan.accepted_domains()
            .iter()
            .filter_map(|domain| make_username(handle, domain).ok()),
    );
    Ok(Candidate {
        handle: handle.to_string(),
        reserving_names,
    })
}

/// Rule 3's refusal, for a handle one of whose reserving names is taken.
pub fn reserved_refusal(handle: &str) -> String {
    format!("the handle {handle:?} is already taken on this server")
}
