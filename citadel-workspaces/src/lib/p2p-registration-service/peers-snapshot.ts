import type { Peer } from './types';

/**
 * Keeps the peer list reference-stable while it has not changed.
 *
 * `getPeers()` built its arrays with `Array.from` on every call, so the result
 * was never reference-equal to the previous one and no caller could ever bail
 * out of a re-render. `useFileManagerContent` polls it every 2 seconds forever
 * and feeds the result straight to `setState`, so an idle file manager
 * re-rendered its whole tree and grid -- every tile carrying a Radix
 * ContextMenu root -- in a 2-second sawtooth for as long as the tab stayed
 * open.
 *
 * Fixed here, at the shared source, rather than at that one caller: the
 * identity is `getPeers()`'s contract, and every other consumer had the same
 * trap waiting.
 *
 * WHY ELEMENT COMPARISON RATHER THAN A DIRTY FLAG. The service hands both peer
 * maps to helper modules by reference, so a flag maintained by the class alone
 * would go stale the moment one of them mutated a map directly -- and a stale
 * "unchanged" here means the UI silently stops updating, which is far worse
 * than the re-render being fixed. The peer count is small; the cost of being
 * right is a loop over it.
 *
 * Its own module so it can be tested without importing the service singleton,
 * whose module graph pulls in the websocket layer and cannot be constructed
 * under vitest.
 */
export interface PeerLists {
  allPeers: Peer[];
  registeredPeers: Peer[];
}

/** Same length, and every element the same object. */
export function sameMembers(a: readonly Peer[], b: readonly Peer[]): boolean {
  if (a.length !== b.length) return false;
  for (let i: number = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * `previous` if it still describes the same peers, otherwise `next`.
 *
 * Returning the previous OBJECT, not merely equal arrays: callers destructure
 * it, so the wrapper's identity matters as much as the arrays'.
 */
export function stableLists(previous: PeerLists | null, next: PeerLists): PeerLists {
  if (
    previous &&
    sameMembers(previous.allPeers, next.allPeers) &&
    sameMembers(previous.registeredPeers, next.registeredPeers)
  ) {
    return previous;
  }
  return next;
}
