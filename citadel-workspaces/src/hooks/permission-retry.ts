/**
 * How long to wait before asking for a domain's permissions again.
 *
 * `usePermission` asked once per domain and recorded that it had asked. The
 * guard exists for a good reason — without it, a fetch that keeps returning
 * nothing spins forever — but `fetchPermissionsForDomain` returns `null` on
 * failure rather than throwing, so one timed-out request during workspace
 * start-up looked exactly like a completed one.
 *
 * The domain was then marked asked-for, the cache stayed empty, and nothing
 * ever changed to trigger another attempt: the effect's dependencies only move
 * when a fetch SUCCEEDS. Every permission-gated control on that node stayed
 * disabled for the life of the page. CI caught it as the workspace admin
 * waiting sixty seconds for their own Edit button:
 *
 *   63 × locator resolved to <button disabled ...>Edit</button>
 *
 * A workspace administrator who cannot edit, with no error and nothing to
 * press, is indistinguishable from a permissions bug in the server.
 *
 * Bounded, and it gives up: a domain that genuinely cannot be read should stop
 * being asked about, and the denial reason is what the user sees either way.
 * Arithmetic only, so the schedule is testable without a React tree.
 */

/** Waits between attempts, in ms. Its length is the retry budget. */
export const PERMISSION_RETRY_DELAYS_MS: readonly number[] = [400, 1_200, 3_000];

/** One initial try plus one per delay. */
export const MAX_PERMISSION_ATTEMPTS: number = PERMISSION_RETRY_DELAYS_MS.length + 1;

/**
 * How long to wait before attempt number `attemptsSoFar + 1`, or `null` when
 * the budget is spent.
 */
export function nextRetryDelayMs(attemptsSoFar: number): number | null {
  if (attemptsSoFar < 1) return 0;
  const delay: number | undefined = PERMISSION_RETRY_DELAYS_MS[attemptsSoFar - 1];
  return delay ?? null;
}
