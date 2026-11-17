/**
 * Whether the store may consider itself initialised.
 *
 * `local-db-client` refuses to write any key that was never successfully read.
 * That is correct — every persist here writes the WHOLE list, and writing a list
 * assembled without a read replaces what is stored with whatever this tab
 * happens to hold, which after a failed read is nothing.
 *
 * The consequence is that a failed read at startup is not a transient miss. It
 * is a permanent one, unless something reads the key again: every later write is
 * refused with
 *
 *     Refusing to write outgoing: '…' was never successfully read
 *
 * for the life of the tab, with nothing on screen. A peer request that cannot be
 * persisted is a peer request the other side never learns about. That exact line
 * appears in the CI logs of the failing P2P specs.
 *
 * `initialize()` discarded both `LoadOutcome`s and latched unconditionally. It
 * now latches only when both keys were actually read, so the next call retries.
 *
 * A module of its own, and a pure function, so the rule is testable without
 * standing up the store — and because the service was over the 250-line limit,
 * which is the right prompt to extract a unit rather than compress the reason.
 */
import type { LoadOutcome } from './local-db-client';

/**
 * `true` when every key reached a conclusion.
 *
 * `absent` counts as read: a key that genuinely holds nothing is a complete
 * picture of nothing, and a first-run user's first write must be allowed to
 * land. Only `failed` — a timeout, a socket loss, a rejected read — withholds
 * the latch.
 */
export function everyKeyWasRead(outcomes: readonly LoadOutcome[]): boolean {
  // An empty list is not "everything was read". Nothing was.
  if (outcomes.length === 0) return false;
  return outcomes.every((outcome) => outcome !== 'failed');
}
