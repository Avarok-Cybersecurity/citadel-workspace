/**
 * While the agent is re-dialling the workspace server for a session
 * (`ServerConnectionLost` with `reconnecting: true`) every poll round asks a session
 * that cannot answer yet. The poll pauses for that window and resumes on
 * `ServerReconnected`.
 *
 * Nothing is mocked: the poll runs on vitest's fake clock against a counting fake agent,
 * and the reconnect messages are the agent's real shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPeerPoll, type PeerPoll, type PeerPollDeps } from '../peer-poll';
import { followReconnect } from '../reconnect-pause';

const INTERVAL_MS: number = 30_000;
const OWN: bigint = 7n;
const asOwn = async (): Promise<bigint | null> => OWN;

function counting(): { deps: PeerPollDeps; checks: () => number } {
  let checks: number = 0;
  const deps: PeerPollDeps = {
    check: async (): Promise<void> => { checks++; },
    currentCid: async (): Promise<bigint | null> => OWN,
    activeSessions: async () => ({ ok: true, sessions: [], signedOut: [] }),
    onSessionGone: (): void => undefined,
    onError: (): void => undefined,
  };
  return { deps, checks: () => checks };
}

const lost = (cid: bigint, reconnecting: boolean): unknown => ({ ServerConnectionLost: { cid, reconnecting, request_id: undefined } });
const back = (cid: bigint): unknown => ({ ServerReconnected: { cid, request_id: undefined } });

describe('the peer poll while the session reconnects', async () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('asks nothing between the loss and the reconnect, then asks again', async () => {
    const agent: { deps: PeerPollDeps; checks: () => number } = counting();
    const poll: PeerPoll = startPeerPoll(agent.deps, INTERVAL_MS);
    await poll.runNow();
    expect(agent.checks()).toBe(1);

    await followReconnect(poll, lost(OWN, true), asOwn);
    expect(poll.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);
    await poll.runNow();
    expect(agent.checks()).toBe(1);

    await followReconnect(poll, back(OWN), asOwn);
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.checks()).toBe(2); // a round at once, not after a full interval
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(agent.checks()).toBe(3);
  });

  it('NEGATIVE CONTROL: with no loss message the same four intervals ask four times', async () => {
    const agent: { deps: PeerPollDeps; checks: () => number } = counting();
    const poll: PeerPoll = startPeerPoll(agent.deps, INTERVAL_MS);
    await poll.runNow();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);
    expect(agent.checks()).toBe(5);
  });

  it('a loss the agent has given up on does not pause (the session is ending, not returning)', async () => {
    const poll: PeerPoll = startPeerPoll(counting().deps, INTERVAL_MS);
    await followReconnect(poll, lost(OWN, false), asOwn);
    expect(poll.paused).toBe(false);
  });

  it('another session\'s loss and reconnect leave this one alone', async () => {
    const poll: PeerPoll = startPeerPoll(counting().deps, INTERVAL_MS);
    await followReconnect(poll, lost(99n, true), asOwn);
    expect(poll.paused).toBe(false);
    await followReconnect(poll, lost(OWN, true), asOwn);
    await followReconnect(poll, back(99n), asOwn);
    expect(poll.paused).toBe(true);
  });

  it('a stopped poll ignores a reconnect', async () => {
    const poll: PeerPoll = startPeerPoll(counting().deps, INTERVAL_MS);
    poll.stop();
    await followReconnect(poll, back(OWN), asOwn);
    expect(poll.running).toBe(false);
  });
});
