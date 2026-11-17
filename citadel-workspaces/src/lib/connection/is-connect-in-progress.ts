/**
 * Whether a `ConnectFailure` means "you are already connecting/connected".
 *
 * Three sites tested this, with three different needles, and none of them
 * matched what the agent sends:
 *
 *   agent  (requests/connect.rs:67)  "Connection already in progress for user bob"
 *   UI     useLoginHandler.ts:160    'already connected'          -> no match
 *   UI     queries.ts:159            'session already connected'  -> no match
 *   UI     reconnect.ts:174          'localhost is already trying to connect'
 *                                     -> a string that exists nowhere in the
 *                                        stack except that line
 *
 * So on a double-clicked Sign In, or two tabs racing a reconnect:
 * `useLoginHandler` skipped its redirect and showed the raw agent sentence as a
 * toast; `handleConnectFailure` returned early and emitted no
 * `session-already-connected`, so nothing claimed the existing session; and
 * `handleAutoReconnectError` fell through to exponential backoff, retried to its
 * maximum, then gave up broadcasting `isConnected: false` -- while a perfectly
 * good session existed.
 *
 * One predicate, in one place, because three spellings is how three of them come
 * to be wrong independently. `check-connect-in-progress-matches-the-agent.mjs`
 * runs the agent's real message through this function, so the two cannot drift
 * again without a red gate.
 *
 * Note this is the STRING fallback. The `SessionAlreadyActive` variant is the
 * primary signal and is handled by variant elsewhere; this covers the
 * `ConnectFailure` path, which carries only prose.
 */

/** Matches the agent's duplicate-connect refusal, however it is capitalised. */
export function isConnectAlreadyInProgress(message: string | undefined): boolean {
  if (!message) return false;
  const m: string = message.toLowerCase();
  // "Connection already in progress for user X" is what the agent sends today.
  // The other two are kept because they are cheap and a future or older agent
  // may phrase it either way; the gate pins the one that must work.
  return m.includes('already in progress')
    || m.includes('already connected')
    || m.includes('session already active');
}
