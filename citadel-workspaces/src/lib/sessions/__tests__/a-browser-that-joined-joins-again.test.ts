/**
 * A browser that opened a session here too joins it again on its own: the
 * claim that finds the session held elsewhere presents the remembered token
 * and adopts, rather than offering the takeover. Only an agent that hosts the
 * account is asked; an older one knows no tokens and is not sent any.
 *
 * Stood in: the agent socket (claims and attaches answered as the agent
 * does), and `storage-utils`, by a Map through `structuredClone` -- jsdom has
 * no IndexedDB, and that is what IndexedDB does to a value. The token is
 * sealed and opened with real WebCrypto by the production join-token code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { attaches: unknown[]; honoursToken: boolean } = vi.hoisted(() => ({ attaches: [], honoursToken: true }));
const TOKEN: number[] = [9, 8, 7, 6, 5, 4, 3, 2];

vi.mock('@/lib/storage-utils', () => {
  const raw: Map<string, unknown> = new Map();
  return {
    dbGet: async (_s: string, k: string): Promise<unknown> => structuredClone(raw.get(k)),
    dbPut: async (_s: string, k: string, v: unknown): Promise<void> => { raw.set(k, structuredClone(v)); },
    dbDelete: async (_s: string, k: string): Promise<void> => { raw.delete(k); },
  };
});

vi.mock('@/lib/websocket-service', async () => {
  const { eventEmitter } = await import('@/lib/event-emitter');
  return {
    websocketService: {
      claimSession: async (cid: bigint, onlyIfOrphaned: boolean): Promise<void> => {
        throw new Error(onlyIfOrphaned ? `Session ${cid} is not orphaned` : `Session ${cid} is in use by another connection`);
      },
      sendRequest: async (request: Record<string, unknown>): Promise<void> => {
        const body: { request_id: string; management_command: { AttachSession: { proof: unknown } } } = request.ConnectionManagement as { request_id: string; management_command: { AttachSession: { proof: unknown } } };
        h.attaches.push(body.management_command.AttachSession.proof);
        const answer: Record<string, unknown> = h.honoursToken
          ? { SessionAttached: { cid: 7n, role: 'Secondary', token: TOKEN, request_id: body.request_id } }
          : { ConnectionManagementFailure: { cid: 7n, error: "This browser's session token is not valid any more", request_id: body.request_id } };
        queueMicrotask(() => eventEmitter.emit('websocket-message', answer));
      },
    },
  };
});

import { claimSessionForThisTab } from '../claim-session';
import { rememberJoin, browserJoinTokens } from '../join-token';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';


beforeEach(() => { h.attaches = []; h.honoursToken = true; });

describe('a session held by another window', () => {
  it('is joined again with the remembered token, and adopted', async () => {
    await greetAs(true);
    await rememberJoin(browserJoinTokens, 7n, Uint8Array.from(TOKEN));
    expect(await claimSessionForThisTab(7n)).toEqual({ status: 'already-active' });
    expect(h.attaches).toEqual([{ Token: TOKEN }]);
  });

  it('is offered, not adopted, when the agent no longer honours the token', async () => {
    await greetAs(true);
    await rememberJoin(browserJoinTokens, 7n, Uint8Array.from(TOKEN));
    h.honoursToken = false;
    expect(await claimSessionForThisTab(7n)).toEqual({ status: 'held-by-another-connection' });
  });

  it('is offered, and no token is sent, to an agent that does not host it', async () => {
    await greetAs('older');
    await rememberJoin(browserJoinTokens, 7n, Uint8Array.from(TOKEN));
    expect(await claimSessionForThisTab(7n)).toEqual({ status: 'held-by-another-connection' });
    expect(h.attaches).toEqual([]);
  });
});
