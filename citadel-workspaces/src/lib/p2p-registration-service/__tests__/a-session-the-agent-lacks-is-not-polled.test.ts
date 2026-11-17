/**
 * The agent keeps sessions in memory, so a restart ends every one of them. A
 * tab still holding one of those CIDs sent ListAllPeers for it every 30s for
 * ever, and the agent answered each with "Session for <cid> not found in
 * session manager".
 *
 * The poll now stops when that refusal is confirmed by the agent's own session
 * list, and only then: a session the agent still lists (reconnecting, say) is
 * polled on, and a GetSessions that failed is not an answer.
 *
 * Nothing is mocked. The agent is a fake object answering the poll's two
 * questions; the 30s interval runs on vitest's fake clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPeerPoll, type PeerPoll, type PeerPollDeps } from '../peer-poll';
import type { ActiveSessionsResult } from '@/lib/connection/queries';
import type { ActiveSession } from '@/types/session-types';

const INTERVAL_MS: number = 30_000;
const STALE_CID: bigint = 7n;
const NOT_FOUND: string = `Session for ${STALE_CID} not found in session manager. Failed to dispatch peer command`;

interface FakeAgent {
  deps: PeerPollDeps;
  checks: () => number;
  gone: bigint[];
}

function fakeAgent(opts: { refusal: string | null; sessions: ActiveSessionsResult }): FakeAgent {
  let checks: number = 0;
  const gone: bigint[] = [];
  const deps: PeerPollDeps = {
    check: async (): Promise<void> => {
      checks++;
      if (opts.refusal !== null) throw new Error(opts.refusal);
    },
    currentCid: async (): Promise<bigint | null> => STALE_CID,
    activeSessions: async (): Promise<ActiveSessionsResult> => opts.sessions,
    onSessionGone: (cid: bigint): void => { gone.push(cid); },
    onError: (): void => undefined,
  };
  return { deps, checks: () => checks, gone };
}

const held: (cid: bigint) => ActiveSession = (cid: bigint): ActiveSession =>
  ({ cid, username: 'u', server_address: 'a' });

async function runFor(poll: PeerPoll, intervals: number): Promise<void> {
  await poll.runNow();
  await vi.advanceTimersByTimeAsync(INTERVAL_MS * intervals);
}

describe('the peer poll', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops polling a session the agent refuses and does not hold', async () => {
    const agent: FakeAgent = fakeAgent({ refusal: NOT_FOUND, sessions: { ok: true, sessions: [held(9n)], signedOut: [] } });
    const poll: PeerPoll = startPeerPoll(agent.deps, INTERVAL_MS);
    await runFor(poll, 5);
    expect(agent.checks()).toBe(1);
    expect(agent.gone).toEqual([STALE_CID]);
    expect(poll.running).toBe(false);
  });

  it('keeps polling when the agent still lists the session', async () => {
    const agent: FakeAgent = fakeAgent({ refusal: NOT_FOUND, sessions: { ok: true, sessions: [held(STALE_CID)], signedOut: [] } });
    const poll: PeerPoll = startPeerPoll(agent.deps, INTERVAL_MS);
    await runFor(poll, 5);
    expect(agent.checks()).toBe(6);
    expect(agent.gone).toEqual([]);
    poll.stop();
  });

  it('keeps polling when the session list could not be read', async () => {
    const agent: FakeAgent = fakeAgent({ refusal: NOT_FOUND, sessions: { ok: false, sessions: [], signedOut: [] } });
    const poll: PeerPoll = startPeerPoll(agent.deps, INTERVAL_MS);
    await runFor(poll, 5);
    expect(agent.checks()).toBe(6);
    expect(agent.gone).toEqual([]);
    poll.stop();
  });

  it('keeps polling through other failures without calling the session gone', async () => {
    const agent: FakeAgent = fakeAgent({ refusal: 'ListAllPeers request timed out', sessions: { ok: true, sessions: [], signedOut: [] } });
    const poll: PeerPoll = startPeerPoll(agent.deps, INTERVAL_MS);
    await runFor(poll, 5);
    expect(agent.checks()).toBe(6);
    expect(agent.gone).toEqual([]);
    poll.stop();
  });

  it('polls a healthy session every interval until stopped', async () => {
    const agent: FakeAgent = fakeAgent({ refusal: null, sessions: { ok: true, sessions: [held(STALE_CID)], signedOut: [] } });
    const poll: PeerPoll = startPeerPoll(agent.deps, INTERVAL_MS);
    await runFor(poll, 3);
    poll.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(agent.checks()).toBe(4);
  });
});
