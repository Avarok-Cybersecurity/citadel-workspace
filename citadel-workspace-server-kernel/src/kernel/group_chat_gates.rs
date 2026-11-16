//! How often one member may move a read cursor, and one session may say it is typing.
//!
//! Both are written on every keystroke or scroll by a well-behaved client only after its own
//! debounce, so the server's bound is a ceiling for a client that does not debounce, not the
//! rhythm of a normal one. The decision is `admits`, pure; the map only remembers when each key
//! was last let through, shared across the kernel's clones like the rate limiter.

use crate::platform::Instant;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// One read-cursor write per member per channel per second.
pub const READ_CURSOR_INTERVAL: Duration = Duration::from_secs(1);
/// One typing notice per session per channel every three seconds.
pub const TYPING_INTERVAL: Duration = Duration::from_secs(3);

/// Whether a write at `now` may pass, given when the last one passed.
pub fn admits(last: Option<Instant>, now: Instant, interval: Duration) -> bool {
    match last {
        None => true,
        Some(last) => now.duration_since(last) >= interval,
    }
}

#[derive(Clone, Default)]
pub struct IntervalGate {
    passed: Arc<Mutex<HashMap<String, Instant>>>,
}

impl IntervalGate {
    /// Lets `key` through at `now` when `interval` has passed since it last was, and records it.
    pub fn try_pass(&self, key: String, now: Instant, interval: Duration) -> bool {
        let mut passed = self.passed.lock();
        if !admits(passed.get(&key).copied(), now, interval) {
            return false;
        }
        passed.insert(key, now);
        true
    }
}

#[derive(Clone, Default)]
pub struct GroupChatGates {
    pub read_cursors: IntervalGate,
    pub typing: IntervalGate,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_write_inside_the_interval_is_held() {
        let gate = IntervalGate::default();
        let t0 = Instant::now();
        assert!(gate.try_pass("g:alice".into(), t0, READ_CURSOR_INTERVAL));
        assert!(!gate.try_pass(
            "g:alice".into(),
            t0 + Duration::from_millis(500),
            READ_CURSOR_INTERVAL
        ));
        assert!(gate.try_pass(
            "g:alice".into(),
            t0 + READ_CURSOR_INTERVAL,
            READ_CURSOR_INTERVAL
        ));
    }

    #[test]
    fn keys_do_not_share_a_budget() {
        let gate = IntervalGate::default();
        let t0 = Instant::now();
        assert!(gate.try_pass("g:alice".into(), t0, TYPING_INTERVAL));
        assert!(gate.try_pass("g:bob".into(), t0, TYPING_INTERVAL));
    }
}
