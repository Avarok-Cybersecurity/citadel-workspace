import { describe, it, expect } from 'vitest';
import { stableLists, sameMembers, type PeerLists } from '../peers-snapshot';
import type { Peer } from '../types';

/**
 * A poll that returns a new array every time is a re-render every time.
 *
 * `getPeers()` built its arrays with `Array.from` on each call, so the result
 * was never reference-equal to the previous one. `useFileManagerContent` polls
 * it every 2 seconds forever and feeds the result straight to `setState`, so
 * React could never bail out: an idle file manager re-rendered its whole tree
 * and grid — every tile carrying a Radix ContextMenu root — in a 2-second
 * sawtooth for as long as the tab stayed open.
 *
 * Both directions are pinned, and neither is sufficient alone. "Stable when
 * unchanged" also holds for a function that returns a frozen constant and never
 * reflects a new peer — which would be a worse bug than the one being fixed,
 * because the UI would silently stop updating. "Changes when peers change" also
 * held for the broken version, which changed on every single call.
 */
function peer(cid: bigint): Peer {
  return { cid, username: `u${cid}`, isRegistered: true } as unknown as Peer;
}

function lists(all: Peer[], registered: Peer[]): PeerLists {
  return { allPeers: all, registeredPeers: registered };
}

describe('the peer list keeps its identity while it is the same list', () => {
  it('returns the PREVIOUS object when nothing changed', () => {
    const a: Peer = peer(1n);
    const previous: PeerLists = lists([a], [a]);

    // A fresh object with the same members, as `Array.from` would produce.
    const result: PeerLists = stableLists(previous, lists([a], [a]));

    expect(result).toBe(previous);
    expect(result.registeredPeers).toBe(previous.registeredPeers);
  });

  it('stays stable across many polls, which is what the 2s interval does', () => {
    const a: Peer = peer(1n);
    let current: PeerLists = lists([a], [a]);
    const first: PeerLists = current;

    for (let i: number = 0; i < 30; i += 1) {
      current = stableLists(current, lists([a], [a]));
    }

    expect(current).toBe(first);
  });

  it('returns the NEW object when a peer is added', () => {
    const a: Peer = peer(1n);
    const b: Peer = peer(2n);
    const previous: PeerLists = lists([a], [a]);

    const result: PeerLists = stableLists(previous, lists([a, b], [a, b]));

    expect(result).not.toBe(previous);
    expect(result.registeredPeers).toHaveLength(2);
  });

  it('returns the NEW object when a peer is removed', () => {
    const a: Peer = peer(1n);
    const b: Peer = peer(2n);
    const previous: PeerLists = lists([a, b], [a, b]);

    const result: PeerLists = stableLists(previous, lists([a], [a]));

    expect(result).not.toBe(previous);
    expect(result.registeredPeers).toHaveLength(1);
  });

  it('returns the NEW object when a peer is REPLACED, not merely counted', () => {
    // The case a size- or version-counter would miss: same count, different
    // object. Both maps are handed to helper modules by reference, so a
    // replaced value is a thing that actually happens here.
    const previous: PeerLists = lists([peer(1n)], [peer(1n)]);

    const result: PeerLists = stableLists(previous, lists([peer(1n)], [peer(1n)]));

    expect(result).not.toBe(previous);
  });

  it('notices a change in allPeers even when registeredPeers is untouched', () => {
    // Two lists, one comparison each. Checking only the list the file manager
    // happens to read would leave the other consumer with the original defect.
    const a: Peer = peer(1n);
    const previous: PeerLists = lists([a], [a]);

    const result: PeerLists = stableLists(previous, lists([a, peer(9n)], [a]));

    expect(result).not.toBe(previous);
  });

  it('sameMembers is identity, not equality', () => {
    // A structural comparison would call two distinct-but-equal peers the same
    // and pin a stale object forever.
    expect(sameMembers([peer(1n)], [peer(1n)])).toBe(false);
    const a: Peer = peer(1n);
    expect(sameMembers([a], [a])).toBe(true);
  });
});
