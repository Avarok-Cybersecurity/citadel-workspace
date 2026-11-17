/**
 * Declining a peer registration used to register that peer.
 *
 * The internal service answers `PeerRegisterRespond { accept: false }` with
 * `PeerRegisterSuccess` — accurate from its side, the decline WAS delivered —
 * and the frontend ran the acceptance path on it: isRegistered = true, into
 * registeredPeers, a p2p:peer-registered event, and a broadcast to the other
 * tabs. You declined somebody and they became a contact.
 *
 * Both directions are asserted. A test that only checked the decline would
 * still pass if acceptance had been broken along with it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { isLeader: false }) };
});
vi.mock('@/lib/broadcast-channel-service', () => ({
  broadcastChannelService: { broadcastStateSync: vi.fn() },
}));

import { handleWebSocketMessage, type RegistrationContext } from '../registration';
import { markAsDecline, forgetDeclines } from '../decline-correlation';

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

const PEER: bigint = 4242n;

function successFor(requestId: string): Record<string, unknown> {
  return {
    PeerRegisterSuccess: {
      request_id: requestId,
      cid: 1n,
      peer_cid: PEER,
      peer_username: 'declined-person',
    },
  };
}

describe('declining a peer registration', () => {
  beforeEach(() => { forgetDeclines(); });

  it('does not add the declined peer to registeredPeers', () => {
    const c: RegistrationContext = ctx();
    const requestId: string = 'decline-1';
    markAsDecline(requestId);

    handleWebSocketMessage(successFor(requestId) as never, c);

    expect(c.registeredPeers.has(PEER)).toBe(false);
    expect(c.outgoingRegistrations.has(PEER)).toBe(false);
    expect(c.allPeers.has(PEER)).toBe(false);
  });

  it('still registers the peer when the response answers a real acceptance', () => {
    const c: RegistrationContext = ctx();

    handleWebSocketMessage(successFor('not-a-decline') as never, c);

    expect(c.registeredPeers.get(PEER)?.isRegistered).toBe(true);
    expect(c.outgoingRegistrations.has(PEER)).toBe(true);
  });

  it('consumes the record, so a later response for a reused id registers normally', () => {
    const c: RegistrationContext = ctx();
    markAsDecline('reused');
    handleWebSocketMessage(successFor('reused') as never, c);
    expect(c.registeredPeers.has(PEER)).toBe(false);

    handleWebSocketMessage(successFor('reused') as never, c);
    expect(c.registeredPeers.has(PEER)).toBe(true);
  });
});
