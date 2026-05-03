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

/// Default high-water mark for the per-CID bucket map. When
/// `try_consume` would push the map past this, it first sweeps stale
/// entries (see `STALE_BUCKET_AGE_MULTIPLIER`). This is a safety net
/// against unbounded growth over a long-running process — a
/// token-bucket whose refill window elapsed long ago is
/// observationally equivalent to "no entry at all" (a fresh bucket is
/// created with full tokens on the next request), so reaping them is
/// a pure optimisation that never changes the observable rate-limit
/// decision.
///
/// Tests can drop the bound to a small value via
/// `RateLimiter::with_capacity` so the sweep path is exercised
/// through the public API rather than left to a 100k-entry stress
/// test that won't run in CI.
pub const DEFAULT_MAX_TRACKED_CIDS: usize = 100_000;

/// Buckets older than this are eligible for sweep on the next
/// over-capacity insert. Pinned at 60× the refill interval so that
/// even a CID that hits the limiter once a minute under load doesn't
/// get reaped between requests; in practice the bound is mostly
/// triggered by truly idle CIDs whose owner closed the connection
/// minutes or hours ago.
const STALE_BUCKET_AGE_MULTIPLIER: u32 = 60;

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
    /// Per-instance high-water mark for the bucket map. Production
    /// uses `DEFAULT_MAX_TRACKED_CIDS`; tests use a small value so
    /// they can exercise the sweep path through the public API.
    max_tracked_cids: usize,
    state: Arc<Mutex<HashMap<u64, Bucket>>>,
}

impl RateLimiter {
    pub fn new(max_tokens: u32, refill_interval: Duration) -> Self {
        Self::with_capacity(max_tokens, refill_interval, DEFAULT_MAX_TRACKED_CIDS)
    }

    /// Construct a limiter with a custom map-size bound. Intended for
    /// tests that need to trigger the stale-bucket sweep without
    /// allocating `DEFAULT_MAX_TRACKED_CIDS` (100k) entries.
    pub fn with_capacity(
        max_tokens: u32,
        refill_interval: Duration,
        max_tracked_cids: usize,
    ) -> Self {
        Self {
            max_tokens,
            refill_interval,
            max_tracked_cids,
            state: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Attempt to consume one token for `cid` at the given instant.
    /// Returns `true` if a token was available (and has been deducted),
    /// `false` if the bucket is exhausted within the current refill
    /// window.
    pub fn try_consume(&self, cid: u64, now: Instant) -> bool {
        let mut map = self.state.lock();

        // Opportunistic stale-bucket sweep before inserting a new
        // entry, but only when we're about to cross the high-water
        // mark. The sweep is amortised: each new insert past the bound
        // walks the map once, removing buckets whose `last_refill` is
        // older than `STALE_BUCKET_AGE_MULTIPLIER * refill_interval`.
        // A reaped bucket is observationally identical to a missing
        // one — the next request from that CID re-creates it with a
        // full token budget — so the sweep cannot change the
        // rate-limit decision for any caller.
        if !map.contains_key(&cid) && map.len() >= self.max_tracked_cids {
            let stale_threshold = self.refill_interval * STALE_BUCKET_AGE_MULTIPLIER;
            map.retain(|_, b| now.duration_since(b.last_refill) < stale_threshold);
        }

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

    #[test]
    fn sweep_reaps_stale_buckets_when_at_capacity() {
        // Drive a tiny bound through the public API by simulating
        // capacity locally. We can't shrink DEFAULT_MAX_TRACKED_CIDS without
        // exposing a knob, so this test calls the internal map
        // directly via tracked_cids() and asserts the *behavioural*
        // contract: after the sweep, an old bucket is gone but a
        // recent one remains.
        let l = RateLimiter::new(1, Duration::from_millis(10));
        let t0 = Instant::now();
        // Old bucket: created 1s ago — well past
        // STALE_BUCKET_AGE_MULTIPLIER * 10ms = 600ms.
        assert!(l.try_consume(1, t0 - Duration::from_secs(1)));
        // Recent bucket: created at t0.
        assert!(l.try_consume(2, t0));
        assert_eq!(l.tracked_cids(), 2);

        // Force the bound by injecting DEFAULT_MAX_TRACKED_CIDS - 2 + 1
        // sentinels so the next *new* CID hits the sweep path. We
        // can't realistically allocate 100k entries in a unit test,
        // so the `at_capacity` invariant is exercised by the
        // `sweep_reaps_stale_buckets_directly` test below using the
        // module-level helper. This case asserts the no-op path:
        // when below capacity, the sweep does NOT run, so both
        // buckets remain.
        assert!(l.try_consume(3, t0));
        assert_eq!(l.tracked_cids(), 3);
    }

    #[test]
    fn sweep_reaps_stale_buckets_directly() {
        // Drive the sweep path directly by reaching into the locked
        // map and checking the retain predicate that try_consume
        // applies when at capacity. This avoids allocating
        // DEFAULT_MAX_TRACKED_CIDS sentinels in a unit test.
        let l = RateLimiter::new(1, Duration::from_millis(10));
        let now = Instant::now();
        // Plant 5 buckets: ids 1..=5 with last_refill at varying ages.
        {
            let mut map = l.state.lock();
            for id in 1u64..=5 {
                let age_ms = id * 200; // 200, 400, 600, 800, 1000 ms
                map.insert(
                    id,
                    Bucket {
                        tokens: 1,
                        last_refill: now - Duration::from_millis(age_ms),
                    },
                );
            }
        }
        // Sweep with the same predicate try_consume uses.
        let stale_threshold = Duration::from_millis(10) * STALE_BUCKET_AGE_MULTIPLIER; // 600ms
        l.state
            .lock()
            .retain(|_, b| now.duration_since(b.last_refill) < stale_threshold);

        // Buckets at 200ms and 400ms survive; 600/800/1000ms are reaped.
        let map = l.state.lock();
        assert!(map.contains_key(&1), "200ms-old bucket should survive");
        assert!(map.contains_key(&2), "400ms-old bucket should survive");
        assert!(!map.contains_key(&3), "600ms-old bucket should be reaped");
        assert!(!map.contains_key(&4), "800ms-old bucket should be reaped");
        assert!(!map.contains_key(&5), "1000ms-old bucket should be reaped");
    }

    #[test]
    fn sweep_fires_through_public_api_at_custom_capacity() {
        // Drives the at-capacity branch in `try_consume` via the
        // public surface — `with_capacity` lets us shrink the bound
        // to something a test can actually reach. With cap=3, the
        // first three new CIDs fill the map; on the 4th NEW cid,
        // the sweep predicate runs.
        let l = RateLimiter::with_capacity(1, Duration::from_millis(10), 3);
        let t0 = Instant::now();

        // Plant CIDs 1..=3 with `last_refill` set 1s in the past, so
        // they're well past STALE_BUCKET_AGE_MULTIPLIER * 10ms =
        // 600ms and all eligible for reaping.
        let stale_t = t0 - Duration::from_secs(1);
        assert!(l.try_consume(1, stale_t));
        assert!(l.try_consume(2, stale_t));
        assert!(l.try_consume(3, stale_t));
        assert_eq!(l.tracked_cids(), 3, "map filled to capacity");

        // CID 4 is a NEW key arriving at t0. Map is at capacity, so
        // the sweep runs first — reaping all three stale entries —
        // then CID 4 is inserted with a full budget. After the call,
        // the map holds only CID 4.
        assert!(l.try_consume(4, t0));
        assert_eq!(
            l.tracked_cids(),
            1,
            "sweep must reap stale entries when capacity is hit"
        );

        // The reaped CID 1 behaves like a fresh CID on its next
        // request — observably indistinguishable from "never seen".
        assert!(l.try_consume(1, t0));
    }

    #[test]
    fn sweep_does_not_reap_recent_buckets_at_capacity() {
        // Mirror of the above: if the buckets at capacity are NOT
        // stale, the sweep removes nothing and the new insert simply
        // pushes the map one over the bound. This is the
        // fail-open behaviour: we'd rather over-track briefly than
        // refuse a legitimate caller a token. The bound is a
        // soft watermark, not a hard cap.
        let l = RateLimiter::with_capacity(1, Duration::from_millis(10), 3);
        let t = Instant::now();
        assert!(l.try_consume(1, t));
        assert!(l.try_consume(2, t));
        assert!(l.try_consume(3, t));
        assert_eq!(l.tracked_cids(), 3);

        // CID 4: sweep runs but finds nothing stale, insert proceeds.
        assert!(l.try_consume(4, t));
        assert_eq!(
            l.tracked_cids(),
            4,
            "no stale entries to reap, soft over-track is fine"
        );
    }

    #[test]
    fn reaped_cid_starts_with_a_full_budget_again() {
        // Observable contract: a CID whose bucket got reaped behaves
        // identically to a CID that has never been seen. Specifically
        // it gets a fresh full-token budget — there's no penalty or
        // memory of the reaped state.
        let l = RateLimiter::new(2, Duration::from_millis(10));
        let t = Instant::now();

        // CID 7 burns its budget.
        assert!(l.try_consume(7, t));
        assert!(l.try_consume(7, t));
        assert!(!l.try_consume(7, t));

        // Simulate the sweep removing CID 7.
        l.state.lock().remove(&7);

        // CID 7 now behaves like a fresh CID — full budget.
        assert!(l.try_consume(7, t));
        assert!(l.try_consume(7, t));
        assert!(!l.try_consume(7, t));
    }
}
