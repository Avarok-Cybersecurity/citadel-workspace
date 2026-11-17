/**
 * Declining a request takes it off the screen immediately, whatever storage does.
 *
 * `removeRequest` updated the in-memory list, then awaited the LocalDB write,
 * and only THEN announced `peer-requests:updated`. The write can take its full
 * five-second budget and reject (the answer is routed to another tab, or the
 * key was never read and the write is refused), and a rejection skipped the
 * announcement entirely. The modal and the sidebar badge only re-read on that
 * event, so a declined request stayed listed, with the badge at 1, until a
 * reload re-read memory that had been correct all along.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    // Sent, never answered: the persist can only end by timing out or refusing.
    sendMessage: vi.fn((): Promise<void> => Promise.resolve()),
    claimSession: vi.fn((): Promise<void> => Promise.resolve()),
  },
}));

vi.mock('@/lib/p2p/current-cid', () => ({
  getCurrentCid: vi.fn((): Promise<bigint> => Promise.resolve(7n)),
}));

import { peerRegistrationStore } from '../service';
import { eventEmitter } from '@/lib/event-emitter';
import type { PendingPeerRequest } from '../types';

interface UpdatePayload { count: number }

const announced: number[] = [];

beforeEach(async () => {
  announced.length = 0;
  for (const r of await peerRegistrationStore.getPendingRequests()) {
    await peerRegistrationStore.removeRequestByPeerCid(r.peer_cid).catch((): void => undefined);
  }
});

eventEmitter.on('peer-requests:updated', (payload?: UpdatePayload): void => {
  if (payload) announced.push(payload.count);
});

describe('declining a request', () => {
  it('announces the shorter list even when the write cannot land', async () => {
    await peerRegistrationStore.handleIncomingRequest({
      cid: 7n, peer_cid: 42n, peer_username: 'bob',
    } as Parameters<typeof peerRegistrationStore.handleIncomingRequest>[0]);
    const [request]: PendingPeerRequest[] = await peerRegistrationStore.getPendingRequests();
    expect(request?.peer_cid).toBe(42n);
    announced.length = 0;

    // The write is refused here (the key was never read), which is one of the
    // two ways it fails in the field; the other is the timeout.
    await peerRegistrationStore.declineRequest(request.id).catch((): void => undefined);

    expect(await peerRegistrationStore.getPendingCount()).toBe(0);
    expect(announced).toContain(0);
  });
});
