/**
 * A tab whose build is superseded never takes leadership, never opens the browser's socket,
 * and -- when another tab's protocol is too new for it -- sends nothing at all.
 *
 * Real: the election, the version admission, the staleness store and sendToLeader, in one tab.
 * Stood in: the channel, as a recorder of what this tab would post.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeaderElectionState } from '../channel-leader-election';
import type { ChannelMessage } from '../channel-types';
import type { ChannelEnvelope } from '../channel-envelope';
import type { AckResult } from '../outbound-queue';

const OWN_SEQ: number = 1000;

let election: typeof import('../channel-leader-election');
let staleness: typeof import('../tab-staleness');
let skew: typeof import('../version-skew');
let manager: typeof import('../instance-manager')['instanceManager'];
let posted: Array<Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'>>;
let state: LeaderElectionState;

beforeEach(async (): Promise<void> => {
  vi.resetModules();
  vi.useFakeTimers();
  election = await import('../channel-leader-election');
  staleness = await import('../tab-staleness');
  skew = await import('../version-skew');
  manager = (await import('../instance-manager')).instanceManager;
  posted = [];
  state = {
    lastLeaderHeartbeat: 0, leaderCheckInterval: null, heartbeatInterval: null, initTime: Date.now(), challenge: null,
    send: (m: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'>): void => { posted.push(m); },
  };
});

function from(sender: string, type: ChannelMessage['type'], v: ChannelEnvelope | undefined): ChannelMessage {
  return { type, targetInstanceId: '*', senderInstanceId: sender, timestamp: Date.now(), v };
}

function envelope(fields: Partial<ChannelEnvelope>): ChannelEnvelope {
  return { proto: 2, minProto: 2, seq: OWN_SEQ, entry: null, epoch: 0, ...fields };
}

describe('a tab that hears another build', () => {
  it('is stale when that build is newer, and knows a newer tab is open until it says goodbye', () => {
    expect(skew.admitByVersion(from('77', 'instance-announce', envelope({ seq: OWN_SEQ + 1 })))).toBe(true);
    expect(staleness.getTabStaleness()).toEqual({ stale: true, inert: false, cause: 'newer-tab' });
    expect(staleness.newerTabIsOpen()).toBe(true);

    skew.admitByVersion(from('77', 'instance-goodbye', envelope({ seq: OWN_SEQ + 1 })));
    expect(staleness.newerTabIsOpen()).toBe(false);
    expect(staleness.getTabStaleness().stale, 'only a reload replaces the running build').toBe(true);
  });

  it('is not stale for a build of its own seq or an older one', () => {
    skew.admitByVersion(from('77', 'instance-announce', envelope({ seq: OWN_SEQ })));
    skew.admitByVersion(from('78', 'instance-announce', envelope({ seq: OWN_SEQ - 1 })));
    expect(staleness.getTabStaleness().stale).toBe(false);
  });

  it('is inert, and does not read it, when that build cannot be served by this one', () => {
    expect(skew.admitByVersion(from('77', 'leader-heartbeat', envelope({ proto: 3, minProto: 3 })))).toBe(false);
    expect(staleness.getTabStaleness().inert).toBe(true);
  });

  it('does not read a build too old for it, but does read protocol 1', () => {
    expect(skew.admitByVersion(from('77', 'leader-heartbeat', envelope({ proto: 1, minProto: 1 })))).toBe(false);
    expect(skew.admitByVersion(from('78', 'leader-heartbeat', undefined))).toBe(true);
    expect(staleness.getTabStaleness()).toEqual({ stale: false, inert: false, cause: null });
  });
});

describe('a stale tab', () => {
  it('does not claim leadership, even with no leader anywhere', () => {
    staleness.markStale('deployed');
    election.tryBecomeLeader(state);
    vi.advanceTimersByTime(10_000);
    expect(manager.isLeader).toBe(false);
    expect(posted).toEqual([]);
  });

  it('does not reclaim leadership against a claim it would otherwise outrank', () => {
    staleness.markStale('deployed');
    const claimer: bigint = manager.instanceIdAsBigInt + 1n;
    election.handleLeaderElection(state, {
      ...from(claimer.toString(), 'leader-election', envelope({})),
      payload: { isLeader: true, instanceIdBigInt: claimer.toString() },
    });
    expect(manager.isLeader).toBe(false);
    expect(manager.leaderId).toBe(claimer.toString());
  });

  it('refuses to open a socket, giving its leadership up first', () => {
    const relinquish: ReturnType<typeof vi.fn> = vi.fn();
    staleness.assertMayOpenSocket(relinquish);
    expect(relinquish).not.toHaveBeenCalled();

    staleness.markStale('newer-tab');
    expect(() => staleness.assertMayOpenSocket(relinquish)).toThrow(/superseded build/);
    expect(relinquish).toHaveBeenCalledOnce();
  });
});

describe('an inert tab', () => {
  it('sends nothing to the leader and says why', async () => {
    const { sendToLeader } = await import('../send-to-leader');
    staleness.markInert();
    const channel: { send: ReturnType<typeof vi.fn> } = { send: vi.fn() };
    const answer: AckResult = await sendToLeader(channel, { GetSessions: { request_id: 'x' } });
    expect(answer.status).toBe('error');
    expect(answer.error).toMatch(/out of date/);
    expect(channel.send).not.toHaveBeenCalled();
  });
});
