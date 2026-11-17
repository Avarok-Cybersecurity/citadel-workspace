/**
 * Knowing one peer is online says nothing about anybody else.
 *
 * `peerOnlineStatus` returns `null` until a poll has landed, so the sidebar can
 * say "not known" instead of writing "Offline" beside someone who is sitting
 * right there. That guard is only as good as its definition of "a poll has
 * landed" — and `addOnlinePeer` used to rebuild the whole list and call
 * `setOnlinePeers`, which stamps the timestamp.
 *
 * So one registration event dated an incrementally-built set as though the
 * backend had answered. Follower tabs never poll at all — `startBackendPolling`
 * returns early when the tab is not leader — so after a single registration
 * they answered a confident `false` for every peer they had not personally
 * added. That is the exact sentence the third state exists to prevent, restored
 * by the write that was supposed to be harmless.
 *
 * This is the reachability lens from round 399 pointed the other way: there the
 * settled state was unreachable, here it was reachable without ever being
 * earned.
 */
import { describe, it, expect } from 'vitest';
import { P2PConnectionState } from '../tracking';

const ALICE: bigint = 7n;
const BOB: bigint = 9n;

describe('what counts as knowing who is online', () => {
  it('knows nothing before anything has happened', () => {
    const state: P2PConnectionState = new P2PConnectionState();
    expect(state.peerOnlineStatus(ALICE)).toBeNull();
  });

  it('does not learn about everyone from learning about one', () => {
    const state: P2PConnectionState = new P2PConnectionState();
    state.addOnlinePeer(ALICE);

    // The one we were told about.
    expect(state.isPeerOnline(ALICE)).toBe(true);
    // And everybody else is still unknown, not offline.
    expect(state.peerOnlineStatus(BOB)).toBeNull();
  });

  it('answers for everyone once the backend has', () => {
    // The positive control: without this, "always null" would satisfy the tests
    // above and the presence dot would never resolve for anyone.
    const state: P2PConnectionState = new P2PConnectionState();
    state.setOnlinePeers([ALICE], []);

    expect(state.peerOnlineStatus(ALICE)).toBe(true);
    expect(state.peerOnlineStatus(BOB)).toBe(false);
  });

  it('keeps an incrementally known peer when the backend answers later', () => {
    const state: P2PConnectionState = new P2PConnectionState();
    state.addOnlinePeer(ALICE);
    state.setOnlinePeers([BOB], []);

    // A poll replaces the set, which is what makes it authoritative.
    expect(state.peerOnlineStatus(BOB)).toBe(true);
    expect(state.peerOnlineStatus(ALICE)).toBe(false);
  });
});
