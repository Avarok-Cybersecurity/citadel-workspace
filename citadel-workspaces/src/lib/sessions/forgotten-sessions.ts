/**
 * Sessions this tab has removed, held until the server stops reporting them.
 *
 * Deregistering a session removes it locally and then reloads the list, and the
 * reload can hand back the session that was just deleted: `GetSessions` answers
 * from a connection map the deregistration has not propagated to yet. Worse,
 * deregistering stops the WASM client, whose reconnection fires
 * `on-ws-connection-success` — which reloads the list again, from the same
 * not-yet-caught-up server, at a moment nobody chose.
 *
 * `sign-out-session` already does the removal LAST for this reason, and its
 * comment explains why. That is enough against the one reload it performs
 * itself and no help at all against a reload triggered by a reconnection
 * afterwards. CI reported exactly the surviving half: "Deregister Removes: FAIL"
 * beside "Deregister Permanent: PASS" — gone after a reload, still on screen
 * before one.
 *
 * A tombstone rather than a timeout: the condition is "the server still says
 * this exists", so the thing to wait for is the server no longer saying it, not
 * an interval somebody guessed. It clears the first time a list comes back
 * without the session.
 *
 * And it gives up after a while, because a deregistration that FAILED
 * server-side leaves the session listed for ever, and a tombstone with no
 * bound would hide a live session permanently with no way for the user to
 * reach it. A row that lingers is a nuisance; a session you cannot get back to
 * is lost work.
 *
 * Bounded by TIME, not by a count of lists. The first bound allowed three
 * lists, and CI showed the row returning anyway: lists arrive in bursts -- the
 * removal performs one, the reconnection it causes performs another, and the
 * navbar refreshes on its own -- so three of them can pass in a second, while
 * the thing being waited for is the server propagating a deletion. Counting
 * the wrong unit made the bound expire before the condition it was bounding
 * could resolve.
 *
 * Session-scoped by design. A reload is a fresh answer from the server, and by
 * then the deletion has landed.
 */

/**
 * How long a session may stay hidden while the server still lists it.
 *
 * Long enough for a deregistration to propagate through the connection map --
 * seconds, not milliseconds -- and short enough that a deregistration which
 * never took surfaces while the user is still looking at the screen.
 */
const HIDE_FOR_MS: number = 30_000;

/** CID -> when it was forgotten. */
const forgotten: Map<string, number> = new Map<string, number>();

/** Test seam: the clock, so a bound measured in time can be tested in one tick. */
let now: () => number = () => Date.now();

export function useClock(clock: () => number): void {
  now = clock;
}

/** Hide this session until the server stops listing it, or the bound expires. */
export function forgetSession(cid: bigint): void {
  forgotten.set(cid.toString(), now());
}

export function isForgotten(cid: bigint): boolean {
  return forgotten.has(cid.toString());
}

/**
 * Drop tombstones for sessions the server no longer reports.
 *
 * Called with each list as it arrives. A tombstone whose session is absent has
 * done its job; keeping it would hide a CID that could be reissued.
 */
export function reconcileForgotten(present: readonly bigint[]): void {
  const listed: Set<string> = new Set(present.map((cid) => cid.toString()));
  for (const [cid, since] of [...forgotten]) {
    // Absence used to end the tombstone here: gone from the list, job done.
    // It does not, because one absence is not the server having settled. The
    // lists that arrive in the second after a deregistration come from
    // different queries and different views, and one of them omitting the
    // session is routinely followed by another that still carries it -- by
    // which point nothing was hiding it any more. That is precisely the
    // failure this tombstone exists to prevent, reintroduced by the check
    // meant to retire it early.
    //
    // TIME is the only bound that settles anything. `listed` is kept because
    // the log below is worth having, and because a caller passing the list is
    // what proves a reload happened at all.
    void listed;
    // Either the server has not caught up, or the deregistration failed --
    // and after long enough the second is likelier than the first.
    if (now() - since >= HIDE_FOR_MS) forgotten.delete(cid);
  }
}

/** Test seam: the map outlives any component. */
export function rememberEverything(): void {
  forgotten.clear();
  now = (): number => Date.now();
}

/**
 * The sessions a list should actually show.
 *
 * Reconciles first, so a tombstone whose session has finally gone stops hiding
 * anything, and only then filters. Doing it in one place keeps the two halves
 * from being called in the wrong order by the next caller: filtering before
 * reconciling would hide a session for one extra list every time.
 */
export function withoutForgotten<T extends { cid: bigint }>(sessions: readonly T[]): T[] {
  reconcileForgotten(sessions.map((session) => session.cid));
  return sessions.filter((session) => !isForgotten(session.cid));
}
