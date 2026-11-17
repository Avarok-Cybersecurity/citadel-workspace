/**
 * The leader hears the relay answer for a follower's session.
 *
 * Seen live: the leader ran the relay lookup for a follower tab's session; the answer
 * (a MessageNotification naming that session) was routed to the follower, the leader's
 * bus never saw it, and every lookup timed out at 5 s although the answer had arrived at
 * 222 ms. The port now also listens on the leader's pre-routing wire.
 *
 * Real: the port, the event emitter, the extraction and the parser. Stood in: `send`,
 * because there is no agent here.
 */
import { describe, it, expect } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { LEADER_WIRE_EVENT } from '@/lib/websocket/leader-inbound-handler';
import { workspaceIceServersPort } from '../workspace-port';
import type { IceServersPort } from '../cache';
import type { IceServersAnswer } from '@/types/ice-servers';
import { parseIceServersAnswer } from '../parse';

const FOLLOWER_CID: bigint = 14741090851496596846n;

function answerFor(cid: bigint): Record<string, unknown> {
  const body: string = JSON.stringify({ Response: { IceServers: { ice_servers: [{ urls: ['turns:turn.example:443?transport=tcp'], username: 'u', credential: 'c' }], expires_at: 1790223725 } } });
  return { MessageNotification: { cid, peer_cid: 0n, request_id: 'server-side-id', message: Array.from(new TextEncoder().encode(body)) } };
}

describe('the relay lookup, asked by the leader for a follower tab session', () => {
  it('resolves from the leader wire, where the answer is seen before routing', async () => {
    const port: IceServersPort = workspaceIceServersPort({
      send: async (): Promise<void> => { queueMicrotask(() => eventEmitter.emit(LEADER_WIRE_EVENT, answerFor(FOLLOWER_CID))); },
      timeoutMs: 1000,
    });
    const answer: IceServersAnswer | null = parseIceServersAnswer(await port.request(FOLLOWER_CID));
    expect(answer?.kind).toBe('granted');
  });

  it('still ignores an answer for a different session', async () => {
    const port: IceServersPort = workspaceIceServersPort({
      send: async (): Promise<void> => { queueMicrotask(() => eventEmitter.emit(LEADER_WIRE_EVENT, answerFor(FOLLOWER_CID + 1n))); },
      timeoutMs: 200,
    });
    await expect(port.request(FOLLOWER_CID)).rejects.toThrow(/no answer within 200ms/);
  });
});
