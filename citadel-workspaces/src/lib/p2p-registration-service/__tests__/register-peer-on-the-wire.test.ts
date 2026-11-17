/**
 * `registerPeer` -- the auto-accept path's PeerRegister -- through the real
 * module, the real response router and the real session lookup.
 *
 * One mock: `websocketService`, the process boundary to the local agent. It
 * records the frame that would go on the wire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { sent: Array<Record<string, unknown>> } = vi.hoisted((): { sent: Array<Record<string, unknown>> } => ({ sent: [] }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: vi.fn((m: Record<string, unknown>): Promise<void> => { h.sent.push(m); return Promise.resolve(); }),
  },
}));

import { registerPeer, handleWebSocketMessage, type RegistrationContext } from '../registration';
import { instanceManager } from '@/lib/multi-instance';
import { getDefaultSecuritySettings } from '@/lib/security-utils';
import type { Peer, PendingRequestEntry } from '../types';

const ME: bigint = 7n;
const PEER: bigint = 42n;

function context(pending: Map<string, PendingRequestEntry>): RegistrationContext {
  return {
    pendingRequests: pending,
    allPeers: new Map<bigint, Peer>(),
    registeredPeers: new Map<bigint, Peer>(),
    outgoingRegistrations: new Set<bigint>(),
    incomingRegistrations: new Set<bigint>(),
    handleIncomingRegistration: async (): Promise<void> => undefined,
  };
}

/** The frame sent, once there is one. */
async function frame(): Promise<Record<string, unknown>> {
  await vi.waitFor((): void => { expect(h.sent).toHaveLength(1); });
  return h.sent[0].PeerRegister as Record<string, unknown>;
}

beforeEach((): void => {
  h.sent = [];
  instanceManager.setCid(ME);
});

describe('registerPeer on the wire', () => {
  it('sends one PeerRegister from this session to the peer, by bigint CID, with the default settings', async () => {
    const pending: Map<string, PendingRequestEntry> = new Map<string, PendingRequestEntry>();
    const done: Promise<void> = registerPeer(PEER, pending);
    const sent: Record<string, unknown> = await frame();

    expect(sent).toEqual({
      request_id: expect.any(String),
      cid: ME,
      peer_cid: PEER,
      session_security_settings: getDefaultSecuritySettings(),
      connect_after_register: false,
      peer_session_password: null,
    });
    handleWebSocketMessage({ PeerRegisterSuccess: { request_id: sent.request_id, cid: ME, peer_cid: PEER } } as never, context(pending));
    await expect(done).resolves.toBeUndefined();
  });

  it('settles as a success when the agent says the peer is already registered', async () => {
    const pending: Map<string, PendingRequestEntry> = new Map<string, PendingRequestEntry>();
    const done: Promise<void> = registerPeer(PEER, pending);
    const sent: Record<string, unknown> = await frame();

    handleWebSocketMessage({ PeerRegisterFailure: { request_id: sent.request_id, cid: ME, message: 'Peer 42 is already registered' } } as never, context(pending));
    await expect(done).resolves.toBeUndefined();
  });

  it('rejects with the agent\'s words on a genuine failure', async () => {
    const pending: Map<string, PendingRequestEntry> = new Map<string, PendingRequestEntry>();
    const done: Promise<void> = registerPeer(PEER, pending);
    const sent: Record<string, unknown> = await frame();

    handleWebSocketMessage({ PeerRegisterFailure: { request_id: sent.request_id, cid: ME, message: 'no such peer' } } as never, context(pending));
    await expect(done).rejects.toThrow('no such peer');
  });

  it('rejects when the agent could not tell whether the peer is registered', async () => {
    // The agent's refusal to guess (requests/peer/register.rs) contains the phrase
    // "is already registered". A substring test read it as success: the peer was
    // marked registered and broadcast to every tab, with no registration made.
    const pending: Map<string, PendingRequestEntry> = new Map<string, PendingRequestEntry>();
    const done: Promise<void> = registerPeer(PEER, pending);
    const sent: Record<string, unknown> = await frame();
    const refusal: string = 'Could not determine whether 42 is already registered: timed out. Nothing was changed; try again.';

    handleWebSocketMessage({ PeerRegisterFailure: { request_id: sent.request_id, cid: ME, message: refusal } } as never, context(pending));
    await expect(done).rejects.toThrow(refusal);
  });

  it('sends nothing for a request to itself', async () => {
    await expect(registerPeer(ME, new Map<string, PendingRequestEntry>())).rejects.toThrow('Cannot register with self');
    expect(h.sent).toEqual([]);
  });
});
