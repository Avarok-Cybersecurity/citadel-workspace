//! Which SDK requests the Calendar lets through (Calendar design §3.8), pure: an app in another
//! member's session is refused, a change waits for this member's consent to the calling app, and
//! at most `MAX_MUTATIONS_PER_WINDOW` changes a window per app are let through.

use crate::sdk::{SdkCode, SdkRefusal, SdkRoute};
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// Mutations one app may make in one member's calendar per window (design §3.8).
pub const MAX_MUTATIONS_PER_WINDOW: usize = 60;
pub const RATE_WINDOW_MS: u64 = 60_000;
/// A decision an app's request gets: the value, or the refusal its answer carries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum SdkAnswer<T> {
    Ok(T),
    Refused(SdkRefusal),
}

impl<T> From<Result<T, SdkRefusal>> for SdkAnswer<T> {
    fn from(r: Result<T, SdkRefusal>) -> SdkAnswer<T> {
        r.map_or_else(SdkAnswer::Refused, SdkAnswer::Ok)
    }
}

/// The member's answer for one app, as stored (`cal/sdk/allow/<app_id>`). "Allow once" is not
/// stored: it lets the one request through and asks again next time.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum Consent {
    Allow,
    Refuse,
}

/// What to do with a request before reading anything else.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum Gate {
    Proceed,
    /// Ask the member, then decide again with their answer.
    Ask,
    Refuse(SdkRefusal),
}

/// The three layers' last two (the kernel enforces the first): a request from an app in another
/// member's session is refused whatever it asks, since the Calendar answers with its own member's
/// authority; a mutation needs this member's consent for the calling app.
pub fn gate(route: &SdkRoute, caller: &str, acting: &str, consent: Option<Consent>) -> Gate {
    if *route == SdkRoute::Health {
        return Gate::Proceed;
    }
    if caller != acting {
        return Gate::Refuse(SdkRefusal::new(
            SdkCode::CrossUser,
            "only the member's own apps reach their calendar; another member books with /book",
        ));
    }
    if !route.mutates() {
        return Gate::Proceed;
    }
    match consent {
        Some(Consent::Allow) => Gate::Proceed,
        Some(Consent::Refuse) => Gate::Refuse(SdkRefusal::new(
            SdkCode::NotConsented,
            "the member refused this app",
        )),
        None => Gate::Ask,
    }
}

/// One more mutation at `now_ms`, given the instants of this app's mutations so far: the instants
/// to keep (those in the window, and this one) when it fits, `None` when it does not.
pub fn rate_admit(recent_ms: &[u64], now_ms: u64) -> Option<Vec<u64>> {
    let since = now_ms.saturating_sub(RATE_WINDOW_MS);
    let mut kept: Vec<u64> = recent_ms
        .iter()
        .copied()
        .filter(|t| *t > since && *t <= now_ms)
        .collect();
    if kept.len() >= MAX_MUTATIONS_PER_WINDOW {
        return None;
    }
    kept.push(now_ms);
    Some(kept)
}
