/**
 * Leadership is fenced by an epoch: a follower takes heartbeats of the leadership it follows
 * (an equal epoch) or a newer one, and ignores an older one.
 *
 * A leader the browser froze (a background tab, a closed lid) can wake still sure it leads,
 * after another tab was elected. Its followers used to take it back as soon as it spoke.
 * And a leader that keeps its leadership against a newer-numbered one moves its own epoch
 * above it, so the followers that had already taken the other come back.
 *
 * Real: the election and the epoch, in one tab. Stood in: the channel, as a recorder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeaderElectionState } from '../channel-leader-election';
import type { ChannelMessage } from '../channel-types';
import { ownEnvelope } from '../channel-envelope';

let election: typeof import('../channel-leader-election');
let epoch: typeof import('../leadership-epoch');
let envelope: typeof import('../channel-envelope');
let manager: typeof import('../instance-manager')['instanceManager'];
let posted: ChannelMessage[];
let state: LeaderElectionState;

beforeEach(async (): Promise<void> => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  election = await import('../channel-leader-election');
  epoch = await import('../leadership-epoch');
  envelope = await import('../channel-envelope');
  manager = (await import('../instance-manager')).instanceManager;
  posted = [];
  state = {
    lastLeaderHeartbeat: 0, leaderCheckInterval: null, heartbeatInterval: null, initTime: Date.now(), challenge: null,
    send: (m: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'>): void => {
      posted.push({ ...m, senderInstanceId: manager.instanceId, timestamp: Date.now(), v: envelope.ownEnvelope(epoch.envelopeEpoch(manager.isLeader)) });
    },
  };
});

/** A heartbeat of this build from `sender`, under leadership `at`. */
function heartbeat(sender: bigint, at: number): ChannelMessage {
  return { type: 'leader-heartbeat', targetInstanceId: '*', senderInstanceId: sender.toString(), timestamp: Date.now(), v: { ...ownEnvelope(0), epoch: at } };
}

describe('a follower', () => {
  it('keeps taking its leader\'s heartbeats at the same epoch', () => {
    const leader: bigint = manager.instanceIdAsBigInt - 5n;
    election.handleLeaderHeartbeat(state, heartbeat(leader, 7));
    vi.advanceTimersByTime(2000);

    election.handleLeaderHeartbeat(state, heartbeat(leader, 7));

    expect(manager.leaderId).toBe(leader.toString());
    expect(state.lastLeaderHeartbeat).toBe(Date.now());
  });

  it('ignores a leader of an older epoch, and follows one of a newer epoch', () => {
    const leader: bigint = manager.instanceIdAsBigInt - 5n;
    const woken: bigint = manager.instanceIdAsBigInt - 9n;
    election.handleLeaderHeartbeat(state, heartbeat(leader, 7));
    const heardAt: number = state.lastLeaderHeartbeat;
    vi.advanceTimersByTime(2000);

    election.handleLeaderHeartbeat(state, heartbeat(woken, 6));
    expect(manager.leaderId, 'a frozen leader of an older epoch was taken back').toBe(leader.toString());
    expect(state.lastLeaderHeartbeat).toBe(heardAt);

    election.handleLeaderHeartbeat(state, heartbeat(woken, 8));
    expect(manager.leaderId).toBe(woken.toString());
  });
});

describe('a follower hearing a leader report on its socket', () => {
  it('takes the report of the leadership it follows, and not one from an older leadership', async () => {
    const { dispatchChannelMessage } = await import('../channel-message-dispatch');
    const { isLeaderSocketUp } = await import('../agent-socket-state');
    const leader: bigint = manager.instanceIdAsBigInt - 5n;
    const woken: bigint = manager.instanceIdAsBigInt - 9n;
    election.handleLeaderHeartbeat(state, heartbeat(leader, 7));
    const report: (sender: bigint, at: number, up: boolean) => ChannelMessage = (sender: bigint, at: number, up: boolean): ChannelMessage =>
      ({ ...heartbeat(sender, at), type: 'agent-socket', payload: { up } });

    dispatchChannelMessage(report(woken, 6, false), state, (): void => undefined);
    expect(isLeaderSocketUp(), 'a frozen leader\'s report of its old socket was believed').toBe(true);

    dispatchChannelMessage(report(leader, 7, false), state, (): void => undefined);
    expect(isLeaderSocketUp()).toBe(false);
  });
});

describe('a leader', () => {
  it('takes an epoch above every earlier one when it is elected', () => {
    localStorage.setItem('citadel-leader-epoch', '41');
    election.tryBecomeLeader(state);
    expect(manager.isLeader).toBe(true);
    expect(epoch.envelopeEpoch(true)).toBe(42);
  });

  it('kept against a newer-numbered leadership, moves above it so its followers come back', () => {
    election.tryBecomeLeader(state);
    const mine: number = epoch.envelopeEpoch(true);
    const younger: bigint = manager.instanceIdAsBigInt + 5n;

    election.handleLeaderHeartbeat(state, heartbeat(younger, mine + 3));

    expect(manager.isLeader).toBe(true);
    const answer: ChannelMessage | undefined = posted.filter((m: ChannelMessage) => m.type === 'leader-heartbeat').at(-1);
    expect(answer?.v?.epoch).toBeGreaterThan(mine + 3);
  });
});
