/**
 * Scheduling primitives.
 *
 * These exist so code never has to guess a duration. A `setTimeout(…, 100)`
 * placed "to let things settle" is a bet that the machine is at least as fast as
 * the machine it was written on: too short and it races anyway, too long and
 * every user pays the difference on every run. Both failure modes are silent.
 *
 * Prefer, in order:
 *   1. `await` the operation you actually depend on.
 *   2. `waitFor(...)` — proceed the instant a condition holds.
 *   3. `yieldToEventLoop()` — hand control back so the browser can paint.
 *   4. A real delay, only where an external constraint requires one (retry
 *      backoff against a remote service, a poll interval). Say which, in a comment.
 */

/**
 * Give the browser a chance to paint before continuing.
 *
 * `await` alone is not enough: awaiting a resolved promise queues a MICROtask,
 * which runs before the browser gets to render, so a loop of awaits can starve
 * paint entirely and freeze the UI while it runs. A macrotask yields properly.
 *
 * Deliberately `setTimeout(0)` rather than `requestAnimationFrame`: rAF does not
 * fire in a backgrounded tab, so a long file transfer moved to a background tab
 * would stall indefinitely.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export interface WaitForOptions {
  /** Give up after this long. Required — an unbounded wait is a hang. */
  timeoutMs: number;
  /**
   * How often to re-test the condition. Only relevant when there is no event to
   * subscribe to; if there is one, use it instead of this helper.
   */
  intervalMs?: number;
  /** Named in the timeout error, so a failure says what was being waited for. */
  description: string;
  /** Resolve instead of rejecting on timeout. For best-effort settling. */
  resolveOnTimeout?: boolean;
}

/**
 * Wait until `condition` returns true, then continue immediately.
 *
 * This is the replacement for "sleep long enough that it's probably ready". It
 * differs in both directions that matter: it returns as soon as the condition
 * actually holds (usually far sooner than a fixed sleep), and if the condition
 * never holds it says so by name instead of silently continuing into a broken
 * state.
 *
 * The polling interval is a fallback for state that emits no event. When an
 * event exists, `waitForEvent` is the better tool — it costs nothing while idle.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: WaitForOptions
): Promise<boolean> {
  const { timeoutMs, intervalMs = 50, description, resolveOnTimeout = false } = options;
  const deadline: number = Date.now() + timeoutMs;

  // Test before waiting at all: the condition is very often already true, and a
  // helper that always costs one interval would just be a slower sleep.
  for (;;) {
    if (await condition()) return true;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, deadline - Date.now())));
  }

  if (resolveOnTimeout) return false;
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
}

/**
 * Resolve when `subscribe` fires, or reject once `timeoutMs` elapses.
 *
 * Zero cost while waiting, and resolves on the actual signal rather than a guess
 * about when the signal probably happened. `subscribe` must return its own
 * unsubscribe function, which is called on every exit path.
 */
export function waitForEvent<T = void>(
  subscribe: (resolve: (value: T) => void) => () => void,
  options: { timeoutMs: number; description: string }
): Promise<T> {
  const { timeoutMs, description } = options;

  return new Promise<T>((resolve, reject) => {
    let settled: boolean = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      fn();
    };

    const timer: NodeJS.Timeout = setTimeout(
      () => finish(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`))),
      timeoutMs
    );

    // Assigned before use by the subscribe callback below, which cannot fire
    // synchronously before this returns in any of our event sources.
    const unsubscribe: () => void = subscribe(value => finish((): void => resolve(value)));
  });
}
