/**
 * Invoke every subscriber, even if one of them throws.
 *
 * A bare `listeners.forEach(l => l(x))` couples subscribers that have nothing
 * to do with each other: `forEach` propagates, so the first handler to throw
 * both aborts the fan-out — every LATER subscriber silently never learns the
 * thing happened — and unwinds into whatever triggered the notification. Here
 * that caller is `login`/`register`/`clearSession`, so one bad subscriber turns
 * a successful authentication into a thrown error while leaving the other
 * subscribers holding a stale session.
 *
 * This duplicates `notify-listeners.ts` in the UI package rather than sharing
 * it: this package is published independently and must not import from the
 * application. Two copies of six lines is the cost of that boundary; the
 * alternative is a third package for one function.
 */
export function notifyEach<A extends unknown[]>(
  listeners: Iterable<(...args: A) => void>,
  context: string,
  ...args: A
): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error) {
      console.error(`[client-ts] Error in ${context} listener:`, error);
    }
  }
}
