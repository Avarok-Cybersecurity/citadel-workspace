import { debugLog } from '@/lib/debug-config';

/**
 * Invoke every subscriber, even if one of them throws.
 *
 * A bare `listeners.forEach(l => l(x))` couples subscribers that have nothing
 * to do with each other: `forEach` propagates, so the first handler to throw
 * both aborts the fan-out — every LATER subscriber silently never learns the
 * thing happened — and unwinds into whatever triggered the notification, which
 * is usually a caller that was succeeding. On the P2P message path that means
 * an incoming message delivered to some listeners and not others, with no error
 * anywhere near the listener that dropped it.
 *
 * `EventEmitter.emit` has always isolated its handlers this way. The hand-rolled
 * fan-outs did not; this is that same guard, in one place, so the next one can
 * use it rather than re-derive it.
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
      debugLog('notifyEach', `Error in ${context} listener:`, error);
    }
  }
}
