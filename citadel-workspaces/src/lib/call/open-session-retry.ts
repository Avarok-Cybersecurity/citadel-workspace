import { CONNECT_TIMEOUT_MS } from './call-constants';

/**
 * Whether a failed media-session open is worth another try, and how long to
 * wait first.
 *
 * The service's open ends after a fixed wait for the peer's UDP channel and
 * says so in as many words -- "it may still be negotiating (retry shortly)" --
 * and, crucially, PARKS the receiver so a second open awaits the same channel
 * rather than starting over. That half was built and nothing ever called it:
 * one attempt failed and the call was declared dead, showing the user a
 * sentence of protocol text telling them to retry, with no way to.
 *
 * Every other open failure is retried too, deliberately. A peer that genuinely
 * withdrew its UDP offer fails again a second later and the user is told the
 * same true thing a little later; the alternative is matching on the service's
 * prose, which makes two copies of one fact and keeps neither in step.
 *
 * The budget is the connect deadline: retrying past the moment the call is
 * declared failed anyway buys nothing. The next attempt is assumed to take
 * about as long as the one that just failed -- measured rather than assumed,
 * because the service owns that duration and a copy of it here would be a
 * second authority for it.
 *
 * The GAP is the part a CI run corrected. A fixed 750ms made the next attempt
 * land while something was still in flight on the service, which answers "a
 * media open or teardown is already in progress with this peer; retry shortly".
 * That message covers two windows of quite different length, and neither is
 * knowable from here:
 *
 *  - an open still waiting on its UDP channel, which takes as long as an
 *    attempt takes -- measured, as the longest attempt so far;
 *  - a TEARDOWN from the previous call, which refuses in milliseconds and says
 *    nothing about how much longer it needs.
 *
 * So the gap is the larger of a geometric backoff and the longest attempt. The
 * backoff covers the window nothing measures; the measurement covers the window
 * a backoff from 750ms would take too many attempts to reach.
 */
export const MAX_OPEN_ATTEMPTS: 4 = 4;

/** Long enough that a retry is not a busy-loop, short enough to fit four. */
export const OPEN_RETRY_GAP_MS: 750 = 750;

export interface OpenAttemptOutcome {
  /** Attempts already made, including the one that just failed. */
  attemptsMade: number;
  /** Since the first attempt began. */
  elapsedMs: number;
  /** How long the attempt that just failed took. */
  lastAttemptMs: number;
  /** The longest any attempt has taken, as the estimate of the service's window. */
  longestAttemptMs: number;
}

export type OpenRetryDecision = { retry: true; delayMs: number } | { retry: false };

export function nextOpenAttempt(outcome: OpenAttemptOutcome): OpenRetryDecision {
  if (outcome.attemptsMade >= MAX_OPEN_ATTEMPTS) return { retry: false };
  const backoffMs: number = OPEN_RETRY_GAP_MS * 2 ** (outcome.attemptsMade - 1);
  const delayMs: number = Math.max(backoffMs, outcome.longestAttemptMs);
  const wouldFinishAt: number = outcome.elapsedMs + delayMs + outcome.lastAttemptMs;
  if (wouldFinishAt > CONNECT_TIMEOUT_MS) return { retry: false };
  return { retry: true, delayMs };
}
