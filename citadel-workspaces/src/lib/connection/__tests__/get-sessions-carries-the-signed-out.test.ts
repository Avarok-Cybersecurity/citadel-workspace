/**
 * GetSessions' `signed_out` list reaches the caller, from the wire and from the cache alike.
 *
 * The agent (0.8.4) lists there the accounts whose reconnect gave up; an older
 * agent sends no such field, which the agent's own type defines as empty.
 * The state is the production ConnectionState; the socket is a fake that answers
 * the request the way the response handler would.
 */
import { describe, it, expect, vi } from 'vitest';
import { getActiveSessionsResult, type ActiveSessionsResult } from '../queries';
import { ConnectionState } from '../state-cache';
import type { SignedOutAccount } from '@/types/session-types';

/** Leadership plays no part in what these tests check; a follower's answer keeps it inert. */
const NOT_LEADING: () => boolean = (): boolean => false;

const alice: SignedOutAccount = { cid: 7n, username: 'alice', reason: 'CID not registered to this node' };

function agentAnswering(state: ConnectionState, body: Record<string, unknown>): { io: never; asked: () => number } {
  let asked: number = 0;
  const io: Record<string, unknown> = {
    canSendRequests: (): boolean => true,
    waitForWebSocketInit: (): Promise<void> => Promise.resolve(),
    sendWebSocketMessage: vi.fn(async (message: { GetSessions: { request_id: string } }): Promise<void> => {
      asked++;
      state.getPendingRequest(message.GetSessions.request_id)?.resolve({ ...body, request_id: message.GetSessions.request_id });
    }),
  };
  return { io: io as never, asked: () => asked };
}

describe('GetSessions’ signed-out accounts', () => {
  it('are read off the answer, and served again from the cache', async (): Promise<void> => {
    const state: ConnectionState = new ConnectionState(NOT_LEADING);
    const agent: ReturnType<typeof agentAnswering> = agentAnswering(state, { sessions: [], signed_out: [alice] });

    const first: ActiveSessionsResult = await getActiveSessionsResult(state, agent.io);
    const cached: ActiveSessionsResult = await getActiveSessionsResult(state, agent.io);

    expect(first).toEqual({ ok: true, sessions: [], signedOut: [alice] });
    expect(cached).toEqual(first);
    expect(agent.asked()).toBe(1);
  });

  it('are none from an agent that predates them', async (): Promise<void> => {
    const state: ConnectionState = new ConnectionState(NOT_LEADING);
    const result: ActiveSessionsResult = await getActiveSessionsResult(state, agentAnswering(state, { sessions: [] }).io);
    expect(result).toEqual({ ok: true, sessions: [], signedOut: [] });
  });
});
