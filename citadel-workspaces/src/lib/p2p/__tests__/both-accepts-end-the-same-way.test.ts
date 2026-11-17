/**
 * Accepting a peer's request ends the same way whichever path accepted it: the
 * user's click (`executeAcceptRequest`) or the auto-accept policy
 * (`acceptRegistrationRequest`). Both announce the accept and both dial the
 * peer -- once, although the agent's `PeerRegisterSuccess` also triggers
 * auto-connect's own dial.
 *
 * The paths had diverged: the click dialled and announced nothing, the policy
 * announced and left the dial to the event. Each case below runs one path; a
 * path that stops using the shared step fails its row.
 *
 * Real: the registration store, the registration service, the auto-connect
 * service and its dial de-duplication, the event bus. Faked: `websocketService`,
 * the process boundary to the local agent -- it records frames and dials, and
 * answers LocalDB reads as an agent with nothing stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { sent: Array<Record<string, unknown>>; dialled: Array<[bigint, bigint]> } = vi.hoisted(
  (): { sent: Array<Record<string, unknown>>; dialled: Array<[bigint, bigint]> } => ({ sent: [], dialled: [] }),
);

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: vi.fn((m: Record<string, unknown>): Promise<void> => { h.sent.push(m); return Promise.resolve(); }),
    claimSession: vi.fn((): Promise<void> => Promise.resolve()),
    sendLocalDBGet: vi.fn((_c: bigint, key: string): Promise<never> => Promise.reject(new Error(`Key not found: ${key}`))),
    sendLocalDBSet: vi.fn((): Promise<void> => Promise.resolve()),
    openP2PConnection: vi.fn((cid: bigint, target: bigint): Promise<void> => { h.dialled.push([cid, target]); return Promise.resolve(); }),
    getClient: vi.fn((): null => null),
  },
}));

import '@/lib/peer-registration-store';
import { executeAcceptRequest } from '@/lib/peer-registration-store/lifecycle';
import { acceptRegistrationRequest } from '@/lib/p2p-registration-service/connection';
import { handleWebSocketMessage, type RegistrationContext } from '@/lib/p2p-registration-service/registration';
import { instanceManager } from '@/lib/multi-instance';
import { eventEmitter } from '@/lib/event-emitter';
import type { Peer, PendingRequestEntry } from '@/lib/p2p-registration-service/types';

const ME: bigint = 7n;

function context(pending: Map<string, PendingRequestEntry>): RegistrationContext {
  return {
    pendingRequests: pending, allPeers: new Map<bigint, Peer>(), registeredPeers: new Map<bigint, Peer>(),
    outgoingRegistrations: new Set<bigint>(), incomingRegistrations: new Set<bigint>(),
    handleIncomingRegistration: async (): Promise<void> => undefined,
  };
}

/** The request id of the PeerRegister sent to `peer`, once it has been sent. */
async function sentTo(peer: bigint): Promise<string> {
  let id: string = '';
  await vi.waitFor((): void => {
    const frame: Record<string, unknown> | undefined = h.sent
      .map((m) => m.PeerRegister as Record<string, unknown> | undefined)
      .find((r) => r?.peer_cid === peer);
    expect(frame).toBeDefined();
    id = frame!.request_id as string;
  });
  return id;
}

const paths: Array<{ name: string; peer: bigint; accept: (peer: bigint) => Promise<void> }> = [
  {
    name: 'the user\'s click',
    peer: 61n,
    accept: async (peer: bigint): Promise<void> => {
      const done: Promise<void> = executeAcceptRequest({ id: 'card', cid: ME, peer_cid: peer, peer_username: 'bob', timestamp: 0 });
      eventEmitter.emit('websocket-message', { PeerRegisterSuccess: { request_id: await sentTo(peer), cid: ME, peer_cid: peer } });
      await done;
    },
  },
  {
    name: 'the auto-accept policy',
    peer: 62n,
    accept: async (peer: bigint): Promise<void> => {
      const pending: Map<string, PendingRequestEntry> = new Map<string, PendingRequestEntry>();
      const done: Promise<void> = acceptRegistrationRequest(peer, 'bob', pending);
      handleWebSocketMessage({ PeerRegisterSuccess: { request_id: await sentTo(peer), cid: ME, peer_cid: peer } } as never, context(pending));
      await done;
    },
  },
];

beforeEach((): void => {
  h.sent = [];
  h.dialled = [];
  vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
  instanceManager.setCid(ME);
});

describe.each(paths)('accepting through $name', ({ peer, accept }) => {
  it('announces the accept and dials the peer exactly once', async () => {
    const heard: unknown[] = [];
    const off: () => void = eventEmitter.on('p2p:registration-accepted', (e: unknown): void => { heard.push(e); });

    await accept(peer);
    await vi.waitFor((): void => { expect(h.dialled).toContainEqual([ME, peer]); });
    // Every dial path has had time to run: a second dial would be here by now.
    await new Promise((r) => setTimeout(r, 50));
    off();

    expect(heard).toEqual([{ peerCid: peer, peerUsername: 'bob' }]);
    expect(h.dialled.filter(([, to]) => to === peer)).toHaveLength(1);
  });
});
