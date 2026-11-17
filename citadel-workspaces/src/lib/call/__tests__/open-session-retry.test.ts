import { describe, it, expect } from 'vitest';
import { CONNECT_TIMEOUT_MS } from '../call-constants';
import {
  nextOpenAttempt,
  MAX_OPEN_ATTEMPTS,
  OPEN_RETRY_GAP_MS,
  type OpenRetryDecision,
} from '../open-session-retry';

describe('nextOpenAttempt', () => {
  it('retries a first failure that leaves room in the connect budget', () => {
    const decision: OpenRetryDecision = nextOpenAttempt({
      attemptsMade: 1,
      elapsedMs: 5_000,
      lastAttemptMs: 5_000,
      longestAttemptMs: 5_000,
    });
    // Long enough that the attempt that just failed is no longer in flight on
    // the service. A fixed gap put the next open inside the previous one's
    // window, and the service answered "a media open or teardown is already in
    // progress with this peer" -- a failure the retry caused itself.
    expect(decision).toEqual({ retry: true, delayMs: 5_000 });
  });

  it('never waits less than the floor, however fast the failure was', () => {
    expect(
      nextOpenAttempt({ attemptsMade: 1, elapsedMs: 5, lastAttemptMs: 5, longestAttemptMs: 5 }),
    ).toEqual({ retry: true, delayMs: OPEN_RETRY_GAP_MS });
  });

  it('backs off geometrically when every failure is instant', () => {
    // "A media open or teardown is already in progress" comes back in
    // milliseconds and says nothing about how much longer the teardown needs,
    // so there is nothing to measure. Retrying at a fixed gap is how the retry
    // walked into the same window three times over.
    const instant = (attemptsMade: number): OpenRetryDecision =>
      nextOpenAttempt({ attemptsMade, elapsedMs: attemptsMade * 5, lastAttemptMs: 5, longestAttemptMs: 5 });
    expect(instant(1)).toEqual({ retry: true, delayMs: OPEN_RETRY_GAP_MS });
    expect(instant(2)).toEqual({ retry: true, delayMs: OPEN_RETRY_GAP_MS * 2 });
    expect(instant(3)).toEqual({ retry: true, delayMs: OPEN_RETRY_GAP_MS * 4 });
  });

  it('waits out the LONGEST attempt, not the one that just failed', () => {
    // The refusal that says something is already in progress comes back in
    // milliseconds. Sizing the next wait on THAT would retry straight back into
    // the same window; the five-second attempt is the measurement of it.
    expect(
      nextOpenAttempt({ attemptsMade: 2, elapsedMs: 5_010, lastAttemptMs: 5, longestAttemptMs: 5_000 }),
    ).toEqual({ retry: true, delayMs: 5_000 });
  });

  it('stops after the attempt limit even with budget to spare', () => {
    expect(
      nextOpenAttempt({ attemptsMade: MAX_OPEN_ATTEMPTS, elapsedMs: 0, lastAttemptMs: 0, longestAttemptMs: 0 }),
    ).toEqual({ retry: false });
  });

  it('stops when another attempt would land past the connect deadline', () => {
    // The call is declared failed at CONNECT_TIMEOUT_MS regardless, so an
    // attempt that could not finish before then buys the user nothing but a
    // longer wait for the same news.
    const lastAttemptMs: number = 12_000;
    const elapsedMs: number = CONNECT_TIMEOUT_MS - lastAttemptMs;
    expect(
      nextOpenAttempt({ attemptsMade: 1, elapsedMs, lastAttemptMs, longestAttemptMs: lastAttemptMs }),
    ).toEqual({ retry: false });
  });

  it('measures the next attempt by the one that just failed, not a copy of the service constant', () => {
    // Same elapsed time, same attempt count: only the observed duration of the
    // failed attempt decides. A fast failure still has room; a slow one does not.
    const elapsedMs: number = 20_000;
    expect(
      nextOpenAttempt({ attemptsMade: 1, elapsedMs, lastAttemptMs: 1_000, longestAttemptMs: 1_000 }).retry,
    ).toBe(true);
    expect(
      nextOpenAttempt({ attemptsMade: 1, elapsedMs, lastAttemptMs: 15_000, longestAttemptMs: 15_000 }).retry,
    ).toBe(false);
  });
});
