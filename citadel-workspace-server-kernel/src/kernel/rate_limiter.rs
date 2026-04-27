//! Per-CID token-bucket rate limiter.
//!
//! Background
//! ----------
//! The original implementation kept the bucket as two locals
//! (`rate_limit_tokens: u32`, `last_refill: Instant`) inside each
//! connection task. That means a single user opening N concurrent
//! connections gets N independent buckets and effectively N × MAX
//! requests per second - the limiter provides no protection against a
//! single actor whatsoever.
//!
//! This module moves the bucket to **per-CID shared state** so all
//! connections owned by the same client identity share one budget.
//!
//! Wiring
//! ------
//! A single `RateLimiter` is constructed in
//! `async_kernel::AsyncCitadelWorkspaceKernel::new` and `clone()`d into
//! every accepted connection task; each connection's `recv` loop calls
//! `try_consume(current_cid, Instant::now())` before parsing/dispatching
//! the message and returns a `WorkspaceProtocolResponse::Error` when
//! the budget is exhausted. See `src/kernel/async_kernel.rs` (search
//! for `rate_limiter.try_consume`). This module is the data plane; the
//! call site is the control plane.
//!
//! Concurrency
//! -----------
//! `parking_lot::Mutex` is used because the critical section is small
//! (a few HashMap operations and integer arithmetic, no `await`) and
//! parking_lot has lower overhead than `std::sync::Mutex` for
//! short-lived locks. The mutex is never held across an await point, so
//! a sync mutex is correct here.
//!
//! Memory
//! ------
//! The internal map grows monotonically with the unique-CID set
//! observed since process start. There is no proactive eviction.
//!
//! Per-entry footprint in a `HashMap<u64, Bucket>`: 8 bytes for the
//! key + ~16 bytes for the bucket (`u32` tokens + `Instant`) + the
//! HashMap's per-entry overhead (~8 bytes for the hash + slot
//! bookkeeping) — call it ~32 bytes amortised. So roughly 30k unique
//! CIDs per MiB, ~1 GiB at 30M CIDs. That's negligible for a
//! workspace deployment whose unique-user set will plateau in the
//! thousands-to-tens-of-thousands range over months of operation;
//! large multi-tenant SaaS shapes (millions of churning users on a
//! long-running process) would want an LRU sweep on `last_refill` —
//! the public surface (`try_consume`) is small enough to swap the
//! backing store without changing call sites when that day comes.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Default budget the kernel applies if it doesn't override.
pub const DEFAULT_RATE_LIMIT_MAX: u32 = 100;
/// Default refill window the kernel applies if it doesn't override.
pub const DEFAULT_RATE_LIMIT_REFILL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy)]
struct Bucket {
    /// Tokens currently available in this CID's bucket.
    tokens: u32,
    /// When this bucket was last fully refilled.
    last_refill: Instant,
}

impl Bucket {
    fn new(now: Instant, max: u32) -> Self {
        Self {
            tokens: max,
            last_refill: now,
        }
    }
}

/// Per-CID token-bucket rate limiter.
///
/// Construct with `new(max_tokens, refill_interval)` and call
/// `try_consume(cid, now)` for each request. Returns `true` when the
/// request is permitted; `false` when the bucket is exhausted and the
/// caller should reject the request.
///
/// `now` is taken as a parameter (rather than read internally) so tests
/// can drive time deterministically; production callers should pass
/// `tokio::time::Instant::now().into_std()` or `std::time::Instant::now()`.
#[derive(Clone)]
pub struct RateLimiter {
    max_tokens: u32,
    refill_interval: Duration,
    state: Arc<Mutex<HashMap<u64, Bucket>>>,
}

impl RateLimiter {
    pub fn new(max_tokens: u32, refill_interval: Duration) -> Self {
        Self {
            max_tokens,
            refill_interval,
            state: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Attempt to consume one token for `cid` at the given instant.
    /// Returns `true` if a token was available (and has been deducted),
    /// `false` if the bucket is exhausted within the current refill
    /// window.
    pub fn try_consume(&self, cid: u64, now: Instant) -> bool {
        let mut map = self.state.lock();
        let bucket = map
            .entry(cid)
            .or_insert_with(|| Bucket::new(now, self.max_tokens));

        // Refill if the window has elapsed since the last refill. Using
        // `>=` matches the prior inline behaviour, which refilled on the
        // boundary tick.
        if now.duration_since(bucket.last_refill) >= self.refill_interval {
            bucket.tokens = self.max_tokens;
            bucket.last_refill = now;
        }

        if bucket.tokens == 0 {
            return false;
        }
        bucket.tokens -= 1;
        true
    }

    /// Number of CIDs currently tracked. Exposed for diagnostics/tests.
    pub fn tracked_cids(&self) -> usize {
        self.state.lock().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limiter() -> RateLimiter {
        RateLimiter::new(3, Duration::from_secs(1))
    }

    #[test]
    fn allows_requests_up_to_max_then_rejects() {
        let l = limiter();
        let t = Instant::now();
        assert!(l.try_consume(1, t));
        assert!(l.try_consume(1, t));
        assert!(l.try_consume(1, t));
        // Bucket exhausted within the current refill window.
        assert!(!l.try_consume(1, t));
    }

    #[test]
    fn refills_after_the_interval_elapses() {
        let l = limiter();
        let t0 = Instant::now();
        for _ in 0..3 {
            assert!(l.try_consume(7, t0));
        }
        assert!(!l.try_consume(7, t0));

        // Cross the refill boundary (>= refill_interval).
        let t1 = t0 + Duration::from_secs(1);
        assert!(l.try_consume(7, t1));
        assert!(l.try_consume(7, t1));
        assert!(l.try_consume(7, t1));
        assert!(!l.try_consume(7, t1));
    }

    #[test]
    fn does_not_refill_inside_the_interval() {
        let l = limiter();
        let t0 = Instant::now();
        for _ in 0..3 {
            assert!(l.try_consume(2, t0));
        }
        let t_just_under = t0 + Duration::from_millis(999);
        assert!(!l.try_consume(2, t_just_under));
    }

    #[test]
    fn different_cids_have_independent_buckets() {
        let l = limiter();
        let t = Instant::now();
        // CID 10 burns its whole budget...
        for _ in 0..3 {
            assert!(l.try_consume(10, t));
        }
        assert!(!l.try_consume(10, t));
        // ...CID 11 still has its full budget.
        assert!(l.try_consume(11, t));
        assert!(l.try_consume(11, t));
        assert!(l.try_consume(11, t));
        assert!(!l.try_consume(11, t));
    }

    #[test]
    fn the_same_cid_shares_its_bucket_across_callers() {
        // This is the property the previous per-connection implementation
        // got wrong: a CID with multiple callers must share one budget.
        let l = limiter();
        let t = Instant::now();
        // Simulate two connection tasks owned by the same CID.
        assert!(l.try_consume(42, t));
        assert!(l.try_consume(42, t));
        assert!(l.try_consume(42, t));
        // Either caller now sees the bucket as exhausted - opening a
        // new connection cannot conjure up extra tokens.
        assert!(!l.try_consume(42, t));
    }

    #[test]
    fn boundary_request_at_zero_tokens_returns_false_without_underflow() {
        // Regression guard: `tokens -= 1` must not run when tokens == 0.
        let l = RateLimiter::new(1, Duration::from_secs(1));
        let t = Instant::now();
        assert!(l.try_consume(99, t));
        assert!(!l.try_consume(99, t));
        // Still false on a second attempt - and tracked_cids is 1, not
        // some panic / overflow indicator.
        assert!(!l.try_consume(99, t));
        assert_eq!(l.tracked_cids(), 1);
    }

    #[test]
    fn first_request_per_new_cid_is_allowed_even_if_window_expired() {
        // A bucket created right now should immediately have a full
        // budget; the refill check should not reset back to zero on
        // first use just because the freshly-created `last_refill` is
        // "now".
        let l = limiter();
        let t = Instant::now();
        assert!(l.try_consume(123, t));
    }
}
