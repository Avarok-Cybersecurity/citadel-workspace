/**
 * Whether the shared `citadel_sessions` key has actually been read.
 *
 * `storeSessionsToLocalDB` writes the WHOLE list, and the key is shared by
 * every tab. That is only sound when the list in memory came from the key. If
 * the read failed -- timed out, socket down, storage denied -- the list is
 * empty for a reason that has nothing to do with what is stored, and writing
 * it deletes every remembered account. Silently, because the write succeeds.
 *
 * Round 596 narrowed two of those writes to a single-session upsert and left
 * five whole-list writers behind, in session-list.ts, session-management.ts
 * and service.ts. So the guard belongs on the one method all of them call, and
 * this flag is what that method consults.
 *
 * A module of its own, rather than a `let` inside io-websocket.ts, because the
 * two places that classify a failed read -- session-management and
 * persist-one-session -- both need to set it, and importing io-websocket from
 * them closes a cycle that leaves `ConnectionIOWebSocket` undefined at load
 * time. The state is one key's state; it does not belong to the class that
 * happens to read it.
 *
 * Module-level, not per-instance: the key is one key, and a second
 * ConnectionIO reading it does not make an earlier one's empty list truthful.
 */
let sessionsWereRead: boolean = false;

/** Record that a read reached the key, whatever it found. */
export function markSessionsRead(): void {
  sessionsWereRead = true;
}

/**
 * Whether a whole-list write may proceed.
 *
 * Genuine absence counts as read: a key that holds nothing is a complete
 * picture of nothing, and a first-run user's first write must land. Callers
 * reach that conclusion with `isGenuinelyAbsent` and call `markSessionsRead`.
 */
export function sessionsHaveBeenRead(): boolean {
  return sessionsWereRead;
}

/** For tests: forget the read, so a scenario starts cold. */
export function resetSessionReadTracking(): void {
  sessionsWereRead = false;
}
