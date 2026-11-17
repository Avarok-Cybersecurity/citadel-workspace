/**
 * Declining a peer request has to tell the sender.
 *
 * `declineRequest` removed the local entry and nothing else — the backend's
 * `PeerRegisterRespond { accept: false }` had zero callers anywhere in the UI.
 * Two permanent consequences:
 *
 * - The sender's outgoing store resends every five minutes forever, and the
 *   recipient's dedup only checks LIVE pending requests, so the declined request
 *   reappeared on their screen every five minutes, indefinitely.
 * - The sender sat on a disabled "Awaiting Response…" with no cancel, never
 *   learning they had been declined.
 *
 * Neither side had a way forward except the recipient giving in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { sent: Array<Record<string, unknown>>; fail: boolean; } = vi.hoisted((): { sent: Array<Record<string, unknown>>; fail: boolean; } => ({ sent: [] as Array<Record<string, unknown>>, fail: false }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: vi.fn((m: Record<string, unknown>) => {
      if (h.fail) return Promise.reject(new Error('socket down'));
      h.sent.push(m);
      return Promise.resolve();
    }),
    claimSession: vi.fn(() => Promise.resolve()),
  },
}));

import { executeDeclineRequest } from '../lifecycle';
import type { PendingPeerRequest } from '@/lib/peer-registration-store/types';

const request: PendingPeerRequest = {
  id: 'req-1',
  cid: 7n,
  peer_cid: 42n,
  peer_username: 'alice',
} as Parameters<typeof executeDeclineRequest>[0];

beforeEach(() => {
  h.sent = [];
  h.fail = false;
});

describe('executeDeclineRequest', () => {
  it('sends a refusal naming the peer it refuses', async () => {
    await executeDeclineRequest(request);

    expect(h.sent).toHaveLength(1);
    const payload: Record<string, unknown> = h.sent[0].PeerRegisterRespond as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(payload.accept).toBe(false);
    expect(payload.peer_cid).toBe(42n);
    expect(payload.cid).toBe(7n);
  });

  it('does not throw when the socket is down', async () => {
    h.fail = true;

    // Best-effort by design: the local removal must happen either way. A
    // decline the user performed and then watched reappear — for a second
    // reason — is worse than one the sender has not heard about yet, and the
    // sender's own resend is the backstop.
    await expect(executeDeclineRequest(request)).resolves.toBeUndefined();
  });

  it('sends nothing when there is no session to send it from', async () => {
    // `cid` is typed non-optional but is genuinely absent for a request that
    // arrived before a session settled, which is exactly when this guard
    // matters — hence the cast rather than a shape the type forbids.
    const sessionless: PendingPeerRequest = { ...request, cid: undefined } as unknown as typeof request;
    await executeDeclineRequest(sessionless);
    expect(h.sent).toEqual([]);
  });
});

describe('declineRequest calls it', () => {
  it('sends the refusal before removing the local entry', async () => {
    // The unit above is correct and would stay correct with declineRequest
    // still removing locally and nothing else — which is the state this found.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { stripComments } = await import('@/test-utils/strip-comments');
    const source: string = stripComments(
      readFileSync(join(process.cwd(), 'src/lib/peer-registration-store/service.ts'), 'utf8'),
    );

    const decline: string = source.slice(source.indexOf('public async declineRequest'));
    const sendAt: number = decline.indexOf('executeDeclineRequest(request)');
    const removeAt: number = decline.indexOf('this.removeRequest(requestId)');
    expect(sendAt).toBeGreaterThan(-1);
    // Order matters: the entry carries the peer_cid the refusal is addressed to.
    expect(sendAt).toBeLessThan(removeAt);
  });
});

describe('sendRegistrationDecline, which a privacy setting also uses', () => {
  it('sends the refusal and marks it, so its answer does not register the peer', async () => {
    const { sendRegistrationDecline } = await import('../lifecycle');
    const { consumeWasDecline } = await import('@/lib/p2p-registration-service/decline-correlation');

    await sendRegistrationDecline(7n, 42n);

    const payload: Record<string, unknown> = h.sent[0].PeerRegisterRespond as Record<string, unknown>;
    expect(payload).toMatchObject({ cid: 7n, peer_cid: 42n, accept: false });
    // The service answers a decline with PeerRegisterSuccess; unmarked, that
    // answer would add the refused stranger as a contact.
    expect(consumeWasDecline(payload.request_id as string)).toBe(true);
  });
});
