/**
 * The accounts this window is signing out or deleting right now.
 *
 * Kept apart from session-ended.ts so the sign-out path, which is on the
 * landing page's critical path, does not carry the watcher's code with it.
 */
const endingHere: Set<bigint> = new Set();

/** Run `ask` (this window's own sign-out or deletion of `cid`) with the account marked as ending here. */
export async function endingHereWhile<T>(cid: bigint, ask: () => Promise<T>): Promise<T> {
  endingHere.add(cid);
  try {
    return await ask();
  } finally {
    endingHere.delete(cid);
  }
}

export function isEndingHere(cid: bigint): boolean {
  return endingHere.has(cid);
}
