/**
 * The two PeerRegister frames the registration store sends: answering a request
 * the user accepted, and resending one of the user's own that went unanswered.
 *
 * Real: the store's lifecycle, the accept-response matcher, the event bus.
 * Faked: `websocketService` (the process boundary to the local agent), which
 * logs every claim and frame in order. Spied: `connectToPeer`, the auto-connect
 * service's entry point -- its handshake has suites of its own, and here the
 * only question is whether the accept asks for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Logged = { via: 'claim' | 'sendMessage' | 'direct'; body: unknown };
const h: { log: Logged[]; client: boolean } = vi.hoisted((): { log: Logged[]; client: boolean } => ({ log: [], client: true }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    claimSession: vi.fn((cid: bigint): Promise<void> => { h.log.push({ via: 'claim', body: cid }); return Promise.resolve(); }),
    sendMessage: vi.fn((m: unknown): Promise<void> => { h.log.push({ via: 'sendMessage', body: m }); return Promise.resolve(); }),
    getClient: vi.fn((): unknown => (h.client ? {
      sendDirectToInternalService: (m: unknown): Promise<void> => { h.log.push({ via: 'direct', body: m }); return Promise.resolve(); },
    } : null)),
  },
}));

import '../index';
import { executeAcceptRequest } from '../lifecycle';
import { resendPeerRegistration } from '@/lib/p2p/send-peer-registration';
import type { OutgoingPeerRequest } from '../types';
import { eventEmitter } from '@/lib/event-emitter';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { getDefaultSecuritySettings } from '@/lib/security-utils';

const ME: bigint = 7n;
const PEER: bigint = 42n;

function frames(): Logged[] {
  return h.log.filter((l: Logged): boolean => l.via !== 'claim');
}

function registerOf(l: Logged): Record<string, unknown> {
  return (l.body as { PeerRegister: Record<string, unknown> }).PeerRegister;
}

beforeEach((): void => {
  h.log = [];
  h.client = true;
});

describe('accepting a request', () => {
  it('claims the session, then sends one PeerRegister back to the requester', async () => {
    const connect = vi.spyOn(p2pAutoConnectService, 'connectToPeer').mockResolvedValue(undefined as never);
    const done: Promise<void> = executeAcceptRequest({ id: 'card-1', cid: ME, peer_cid: PEER, peer_username: 'bob', timestamp: 0 });
    await vi.waitFor((): void => { expect(frames()).toHaveLength(1); });

    expect(h.log.map((l: Logged) => l.via)).toEqual(['claim', 'sendMessage']);
    expect(h.log[0].body).toBe(ME);
    const sent: Record<string, unknown> = registerOf(frames()[0]);
    expect(sent).toEqual({
      request_id: expect.any(String),
      cid: ME,
      peer_cid: PEER,
      session_security_settings: getDefaultSecuritySettings(),
      connect_after_register: false,
      peer_session_password: null,
    });
    expect(sent.request_id).not.toBe('card-1');

    eventEmitter.emit('websocket-message', { PeerRegisterSuccess: { request_id: sent.request_id, cid: ME, peer_cid: PEER } });
    await done;
    expect(connect).toHaveBeenCalledWith(PEER);
    connect.mockRestore();
  });

  it('still connects when the agent says the peer is already registered', async () => {
    const connect = vi.spyOn(p2pAutoConnectService, 'connectToPeer').mockResolvedValue(undefined as never);
    const done: Promise<void> = executeAcceptRequest({ id: 'card-2', cid: ME, peer_cid: PEER, peer_username: 'bob', timestamp: 0 });
    await vi.waitFor((): void => { expect(frames()).toHaveLength(1); });

    const sent: Record<string, unknown> = registerOf(frames()[0]);
    eventEmitter.emit('websocket-message', { PeerRegisterFailure: { request_id: sent.request_id, cid: ME, message: 'Peer 42 is already registered' } });
    await done;
    expect(connect).toHaveBeenCalledWith(PEER);
    connect.mockRestore();
  });
});

describe('resending an unanswered request', () => {
  const outgoing: OutgoingPeerRequest = { id: 'req-9', fromCid: ME, toCid: PEER, peerUsername: 'bob', timestamp: 0, timeLastSent: 0 };

  it('claims the sending session and resends under the SAME request id, straight to the client', async () => {
    await resendPeerRegistration(outgoing);

    expect(h.log.map((l: Logged) => l.via)).toEqual(['claim', 'direct']);
    expect(h.log[0].body).toBe(ME);
    expect(registerOf(h.log[1])).toEqual({
      request_id: 'req-9',
      cid: ME,
      peer_cid: PEER,
      session_security_settings: getDefaultSecuritySettings(),
      connect_after_register: false,
      peer_session_password: null,
    });
  });

  it('sends nothing, and says so, when there is no client', async () => {
    h.client = false;
    await expect(resendPeerRegistration(outgoing)).rejects.toThrow('No WebSocket client available');
    expect(frames()).toEqual([]);
  });
});
