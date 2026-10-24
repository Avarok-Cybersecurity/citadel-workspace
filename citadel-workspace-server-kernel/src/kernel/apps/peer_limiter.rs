//! The kernel's own bounds on what a session may ask per second, each counted per asking session
//! and decided before anything is read. Pure: time is the caller's.
//!
//! - `AuthorizePeer` (design §1, amplification): the page asks once per new caller per minute and
//!   rate-limits callers before it asks, so a session asking more often is not a page doing its
//!   job.
//! - A relayed `RequestHead` (R4.4: 30 requests/s per caller): each one reads the caller's and
//!   the serving install, their grants and the audience before a stream opens.
//! - `AdvertiseService`: the host repeats an advertisement every 60 s per instance, so two a
//!   second is far above any page's need.

use citadel_ihttp_types::MAX_REQUESTS_PER_SECOND_PER_CALLER;
use std::collections::HashMap;

/// Questions one session may ask per second.
pub const MAX_PEER_CHECKS_PER_S: u32 = 10;
/// Advertisements one session may make per second.
pub const MAX_ADVERTS_PER_S: u32 = 2;
const WINDOW_MS: u64 = 1000;

/// At most `PER_S` admissions per session in each one-second window.
#[derive(Debug, Default)]
pub struct WindowLimiter<const PER_S: u32> {
    /// Session CID to (its window's start, admissions in it).
    windows: HashMap<u64, (u64, u32)>,
}

pub type PeerCheckLimiter = WindowLimiter<MAX_PEER_CHECKS_PER_S>;
pub type HeadLimiter = WindowLimiter<MAX_REQUESTS_PER_SECOND_PER_CALLER>;
pub type AdvertLimiter = WindowLimiter<MAX_ADVERTS_PER_S>;

impl<const PER_S: u32> WindowLimiter<PER_S> {
    /// Whether `cid` may ask now; counts the question if so.
    pub fn admit(&mut self, cid: u64, now_ms: u64) -> bool {
        self.windows
            .retain(|_, (start, _)| now_ms.saturating_sub(*start) < WINDOW_MS);
        let (_, asked) = self.windows.entry(cid).or_insert((now_ms, 0));
        if *asked >= PER_S {
            return false;
        }
        *asked += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_gets_its_budget_per_window_and_others_are_unaffected() {
        let mut limiter = PeerCheckLimiter::default();
        for _ in 0..MAX_PEER_CHECKS_PER_S {
            assert!(limiter.admit(1, 5));
        }
        assert!(!limiter.admit(1, 999), "over budget within the window");
        assert!(limiter.admit(2, 999), "another session has its own");
        assert!(limiter.admit(1, 1005), "a new window");
    }

    #[test]
    fn each_limiter_has_its_own_budget() {
        let mut heads = HeadLimiter::default();
        let mut adverts = AdvertLimiter::default();
        let admitted = |admit: &mut dyn FnMut() -> bool| (0..100).filter(|_| admit()).count();
        assert_eq!(admitted(&mut || heads.admit(1, 0)), 30);
        assert_eq!(admitted(&mut || adverts.admit(1, 0)), 2);
    }
}
