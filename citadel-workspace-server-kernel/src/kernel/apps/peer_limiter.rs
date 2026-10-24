//! The kernel's own bound on `AuthorizePeer`, per asking session (design §1, amplification):
//! the page asks once per new caller per minute and rate-limits callers before it asks, so a
//! session asking more often than this is not a page doing its job. Pure: time is the caller's.

use std::collections::HashMap;

/// Questions one session may ask per second.
pub const MAX_PEER_CHECKS_PER_S: u32 = 10;
const WINDOW_MS: u64 = 1000;

#[derive(Debug, Default)]
pub struct PeerCheckLimiter {
    /// Session CID to (its window's start, questions asked in it).
    windows: HashMap<u64, (u64, u32)>,
}

impl PeerCheckLimiter {
    /// Whether `cid` may ask now; counts the question if so.
    pub fn admit(&mut self, cid: u64, now_ms: u64) -> bool {
        self.windows
            .retain(|_, (start, _)| now_ms.saturating_sub(*start) < WINDOW_MS);
        let (_, asked) = self.windows.entry(cid).or_insert((now_ms, 0));
        if *asked >= MAX_PEER_CHECKS_PER_S {
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
}
