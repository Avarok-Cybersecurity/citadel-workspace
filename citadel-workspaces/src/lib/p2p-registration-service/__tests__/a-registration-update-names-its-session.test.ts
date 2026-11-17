/**
 * The leader's registered-peer-update is addressed to the session it is about.
 *
 * It went out with no session, so broadcastStateSync stamped the leader tab's own, and a
 * follower signed in as someone else dropped every update about its own registrations.
 * Mocked, because there is one tab here: which tab leads, and the broadcast (a recorder).
 * The registration handler is the real one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sent: Array<{ data: Record<string, unknown>; about: bigint | undefined }> = [];
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { isLeader: true }) };
});
vi.mock('@/lib/broadcast-channel-service', () => ({
  broadcastChannelService: {
    broadcastStateSync: (data: Record<string, unknown>, about?: bigint): void => { sent.push({ data, about }); },
  },
}));

import { handleWebSocketMessage, type RegistrationContext } from '../registration';

function ctx(): RegistrationContext {
  return {
    pendingRequests: new Map(),
    allPeers: new Map(),
    registeredPeers: new Map(),
    outgoingRegistrations: new Set(),
    incomingRegistrations: new Set(),
    handleIncomingRegistration: async (): Promise<void> => {},
  };
}

const FOLLOWER_SESSION: bigint = 14741090851496596846n;
const PEER: bigint = 4242n;

beforeEach(() => { sent.length = 0; });

describe('a registration the leader learns of for a follower session', () => {
  it('an outgoing one that succeeded', () => {
    handleWebSocketMessage({ PeerRegisterSuccess: { request_id: 'r1', cid: FOLLOWER_SESSION, peer_cid: PEER, peer_username: 'bob' } } as never, ctx());
    expect(sent.map((s) => [s.data.type, s.about])).toEqual([['registered-peer-update', FOLLOWER_SESSION]]);
  });

  it('an outgoing one that was already in place', () => {
    handleWebSocketMessage({ PeerRegisterFailure: { request_id: 'r2', cid: FOLLOWER_SESSION, peer_cid: PEER, message: 'Peer already registered' } } as never, ctx());
    expect(sent.map((s) => s.about)).toEqual([FOLLOWER_SESSION]);
  });

  it('an incoming request', () => {
    handleWebSocketMessage({ PeerRegisterNotification: { request_id: 'r3', cid: FOLLOWER_SESSION, peer_cid: PEER, peer_username: 'bob' } } as never, ctx());
    expect(sent.map((s) => s.about)).toEqual([FOLLOWER_SESSION]);
  });

  it('is not broadcast at all when the answer names no session', () => {
    handleWebSocketMessage({ PeerRegisterSuccess: { request_id: 'r4', peer_cid: PEER, peer_username: 'bob' } } as never, ctx());
    expect(sent).toEqual([]);
  });
});
