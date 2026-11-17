/**
 * There were two declines and only one of them told anybody.
 *
 * `peerRegistrationStore.declineRequest` sends
 * `PeerRegisterRespond { accept: false }`, and its comment records why:
 *
 *   Removing the local entry was the whole of decline, so a declined request
 *   came back every five minutes forever.
 *
 * `p2pRegistrationService.declineRegistrationRequest` did exactly the thing
 * that comment describes as the bug — removed the local entry, emitted an event
 * nothing listens for, and sent nothing. It has no callers, which is the only
 * reason it was not live; it is also the one exported from the service's public
 * index under the more obvious name, so it is what a new caller reaches for.
 *
 * Both paths now mean the same thing. The assertion is on the WIRE, because
 * that is the part the peer can observe: a decline that does not leave the
 * machine is not a decline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: unknown[] = [];
const requests: Array<{ id: string; cid: bigint; peer_cid: bigint; peer_username: string }> = [];

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: async (m: unknown): Promise<void> => { sent.push(m); },
  },
}));

vi.mock('@/lib/peer-registration-store', () => ({
  peerRegistrationStore: {
    getPendingRequests: async (): Promise<unknown[]> => requests,
    declineRequest: async (id: string): Promise<void> => {
      const request: { id: string; cid: bigint; peer_cid: bigint; peer_username: string } | undefined =
        requests.find((r) => r.id === id);
      if (!request) throw new Error('Request not found');
      const { executeDeclineRequest } = await import('../peer-registration-store/lifecycle');
      await executeDeclineRequest(request as never);
    },
    removeRequestByPeerCid: async (): Promise<void> => {},
    handleIncomingRequest: async (): Promise<void> => {},
  },
}));

const { declineRegistrationRequest } = await import('../p2p-registration-service/connection');

describe('declining a contact request', () => {
  beforeEach((): void => {
    sent.length = 0;
    requests.length = 0;
    requests.push({ id: 'r1', cid: 1n, peer_cid: 42n, peer_username: 'alice' });
  });

  it('tells the sender, through the service entry point', async () => {
    await declineRegistrationRequest(42n);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      PeerRegisterRespond: { cid: 1n, peer_cid: 42n, accept: false },
    });
  });

  it('says no, not yes', async () => {
    // The positive control worth having: `accept: true` would also be one
    // message on the wire, and would accept the request it was asked to refuse.
    await declineRegistrationRequest(42n);
    expect((sent[0] as { PeerRegisterRespond: { accept: boolean } }).PeerRegisterRespond.accept).toBe(false);
  });

  it('does not invent a response for a request it does not hold', async () => {
    requests.length = 0;
    await declineRegistrationRequest(42n);
    expect(sent).toHaveLength(0);
  });
});
