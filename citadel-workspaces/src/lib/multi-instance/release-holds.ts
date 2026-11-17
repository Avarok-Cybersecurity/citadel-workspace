/**
 * A session's release, held back while the leader is still finishing work AS that session.
 *
 * When a follower closes mid-call it hands the leader its call's goodbye, then asks for its
 * session to be released (departure-steps.ts). Both arrive in order, but the goodbye is async
 * (a signal to each peer, then each media session closed) and the release is one synchronous
 * send. Released first, the session refuses the goodbye. So the goodbye registers a hold, and the
 * release waits for it -- bounded, because a session must not stay held by a tab that has gone.
 *
 * With no hold the release runs synchronously, as it always did: a closing LEADER releases its
 * own session from inside `pagehide`, where nothing asynchronous lives to finish.
 *
 * Pure over its clock (SBIO): the wait is handed in.
 */

/** How long a departed tab's goodbye may delay its session's release. Explicit, not a default:
 *  long enough for a signal and a media close per peer over a live socket, short enough that a
 *  goodbye that never completes does not keep a closed tab's session held. */
export const RELEASE_HOLD_MAX_MS: number = 5_000;

const holds: Map<bigint, Promise<void>> = new Map<bigint, Promise<void>>();

/** Hold `cid`'s release until `work` settles. Holds on one session queue behind each other. */
export function holdRelease(cid: bigint, work: Promise<void>): void {
  const before: Promise<void> = holds.get(cid) ?? Promise.resolve();
  const held: Promise<void> = Promise.allSettled([before, work]).then((): void => undefined);
  holds.set(cid, held);
  void held.then((): void => { if (holds.get(cid) === held) holds.delete(cid); });
}

/** Release now when nothing holds `cid`; otherwise once the holds settle or the bound passes. */
export function releaseAfterHolds(cid: bigint, release: () => void, wait: (ms: number) => Promise<void>): void {
  const held: Promise<void> | undefined = holds.get(cid);
  if (held === undefined) {
    release();
    return;
  }
  void Promise.race([held, wait(RELEASE_HOLD_MAX_MS)]).then(release);
}
