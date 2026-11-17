/**
 * Tests for updatePeerMaps — the function that turns two backend peer lists
 * (all peers / registered peers) into the maps the UI renders from.
 *
 * No module mocking: updatePeerMaps mutates the maps it is handed and performs
 * no I/O, so it is exercised directly.
 */
import { describe, it, expect } from 'vitest';
import { updatePeerMaps } from '../p2p-registration-service/discovery';
import type { Peer, PeerInfoResponse } from '../p2p-registration-service/types';

function peer(cid: bigint, username: string): Peer {
  return { cid, username, fullName: username, isOnline: true, isRegistered: false };
}

describe('updatePeerMaps', () => {
  it('marks peers present in the registered list, and only those', () => {
    const all: Map<bigint, Peer> = new Map<bigint, Peer>();
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>();
    const allResponse: PeerInfoResponse[] = [
      { cid: 1n, username: 'alice' },
      { cid: 2n, username: 'bob' },
    ];

    updatePeerMaps(all, registered, allResponse, [{ cid: 2n, username: 'bob' }]);

    expect(all.get(1n)?.isRegistered).toBe(false);
    expect(all.get(2n)?.isRegistered).toBe(true);
    expect([...registered.keys()]).toEqual([2n]);
  });

  it('preserves a real username when the backend sends a placeholder', () => {
    // The peer registry resolves usernames asynchronously, so a later poll can
    // come back with 'Unknown' for a peer whose name we already learned.
    const all: Map<bigint, Peer> = new Map<bigint, Peer>([[1n, peer(1n, 'alice')]]);
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>();

    updatePeerMaps(all, registered, [{ cid: 1n, username: 'Unknown' }], []);

    expect(all.get(1n)?.username).toBe('alice');
  });

  it('does not preserve a synthesized "User 1234" handle over a real name', () => {
    const all: Map<bigint, Peer> = new Map<bigint, Peer>([[1n, peer(1n, 'User 12345678')]]);
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>();

    updatePeerMaps(all, registered, [{ cid: 1n, username: 'alice' }], []);

    expect(all.get(1n)?.username).toBe('alice');
  });

  it('drops peers that are gone from the backend response', () => {
    const all: Map<bigint, Peer> = new Map<bigint, Peer>([[1n, peer(1n, 'alice')], [2n, peer(2n, 'bob')]]);
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>([[1n, peer(1n, 'alice')]]);

    updatePeerMaps(all, registered, [{ cid: 2n, username: 'bob' }], []);

    expect(all.has(1n)).toBe(false);
    expect(registered.size).toBe(0);
  });

  it('ignores entries with no cid rather than keying them as undefined', () => {
    const all: Map<bigint, Peer> = new Map<bigint, Peer>();
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>();

    updatePeerMaps(all, registered, [{ username: 'nameless' }, { cid: 1n, username: 'alice' }], []);

    expect([...all.keys()]).toEqual([1n]);
  });

  it('registers a peer that appears only in the registered list', () => {
    const all: Map<bigint, Peer> = new Map<bigint, Peer>();
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>();

    updatePeerMaps(all, registered, [], [{ cid: 7n, username: 'carol', online_status: false }]);

    expect(registered.get(7n)).toMatchObject({ username: 'carol', isRegistered: true, isOnline: false });
  });

  it('reports unknown when the backend omits online_status', () => {
    // It used to default to TRUE, so a peer the agent had said nothing about
    // got a green dot -- and presence.ts ORed that flag with the live poll, so
    // the invention outranked the real answer.
    const all: Map<bigint, Peer> = new Map<bigint, Peer>();
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>();

    updatePeerMaps(all, registered, [{ cid: 1n, username: 'alice' }], []);

    expect(all.get(1n)?.isOnline).toBeNull();
  });

  it('still carries the status the backend does report', () => {
    // The positive control: a version that hardcoded null would satisfy the
    // test above and lose every real answer.
    const all: Map<bigint, Peer> = new Map<bigint, Peer>();
    const registered: Map<bigint, Peer> = new Map<bigint, Peer>();

    updatePeerMaps(
      all,
      registered,
      [{ cid: 1n, username: 'alice', online_status: true }, { cid: 2n, username: 'bob', online_status: false }],
      [],
    );

    expect(all.get(1n)?.isOnline).toBe(true);
    expect(all.get(2n)?.isOnline).toBe(false);
  });
});
