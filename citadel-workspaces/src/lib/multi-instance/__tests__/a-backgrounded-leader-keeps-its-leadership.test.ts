/**
 * A leader in a background tab stays the leader; a foreground follower does not take over
 * and give it back, over and over.
 *
 * Seen on the live site, in a loop, in the foreground tab: two "claiming <cid> for another tab
 * failed (leader without client)" lines, then "Network inbound task ended. Messenger is shutting
 * down", then again. The browser runs a background tab's intervals about once a minute, so the
 * real leader's heartbeat came far apart against a five-second dead-leader timeout. The
 * foreground tab challenged and made itself leader at once -- claiming sessions and opening a
 * socket -- and the real leader, which answers a challenge as soon as it hears it, demoted it
 * again, closing the socket it had just opened. Every few seconds, for as long as the leader
 * stayed in the background.
 *
 * Real: the election (both tabs' own instance managers and event buses, one module graph per
 * tab). Stood in, because a test has one page:
 * - the BroadcastChannel between the tabs: a delivery of each tab's message to the other's
 *   election handlers on the next task, as channel-message-dispatch routes those two types,
 *   stamped with the tab's envelope as InstanceChannel.send stamps it (both tabs one build);
 * - the browser's throttling of the background leader: its heartbeat interval is a minute.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LeaderElectionState } from '../channel-leader-election';
import type { ChannelMessage } from '../channel-types';
import { INTERVAL } from '../../timeout-constants';

const BACKGROUND_INTERVAL_MS: number = 60_000;

interface Tab {
  election: typeof import('../channel-leader-election');
  manager: typeof import('../instance-manager')['instanceManager'];
  state: LeaderElectionState;
  promotions: number;
  reachable: boolean;
}

const tabs: Tab[] = [];

function deliver(to: Tab, message: ChannelMessage): void {
  if (!to.reachable) return;
  if (message.type === 'leader-election') to.election.handleLeaderElection(to.state, message);
  if (message.type === 'leader-heartbeat') to.election.handleLeaderHeartbeat(to.state, message);
}

async function openTab(): Promise<Tab> {
  vi.resetModules();
  sessionStorage.clear();
  const election: typeof import('../channel-leader-election') = await import('../channel-leader-election');
  const { instanceManager } = await import('../instance-manager');
  const { eventEmitter } = await import('@/lib/event-emitter');
  const { ownEnvelope } = await import('../channel-envelope');
  const { envelopeEpoch } = await import('../leadership-epoch');
  const tab: Tab = {
    election,
    manager: instanceManager,
    promotions: 0,
    reachable: true,
    state: {
      lastLeaderHeartbeat: 0, leaderCheckInterval: null, heartbeatInterval: null, initTime: Date.now(), challenge: null,
      send: (m: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'> & { senderInstanceId?: string; timestamp?: number }): void => {
        if (!tab.reachable) return;
        const message: ChannelMessage = {
          ...m, senderInstanceId: m.senderInstanceId ?? instanceManager.instanceId, timestamp: Date.now(),
          v: ownEnvelope(envelopeEpoch(instanceManager.isLeader)),
        } as ChannelMessage;
        for (const other of tabs) if (other !== tab) setTimeout((): void => deliver(other, message), 0);
      },
    } as LeaderElectionState,
  };
  eventEmitter.on('instance:leader-changed', (p: { isLeader: boolean }): void => { if (p.isLeader) tab.promotions += 1; });
  tabs.push(tab);
  return tab;
}

beforeEach((): void => { vi.useFakeTimers(); tabs.length = 0; });
afterEach((): void => {
  for (const t of tabs) if (t.state.leaderCheckInterval) clearInterval(t.state.leaderCheckInterval);
  vi.useRealTimers();
});

/** The leader, now in the background, and a follower in the foreground that has heard it. */
async function backgroundLeaderAndForegroundFollower(): Promise<{ leader: Tab; follower: Tab }> {
  const leader: Tab = await openTab();
  leader.election.tryBecomeLeader(leader.state);
  await vi.advanceTimersByTimeAsync(INTERVAL.HEARTBEAT_MS);
  expect(leader.manager.isLeader).toBe(true);
  setInterval((): void => { if (leader.manager.isLeader) leader.election.sendHeartbeat(leader.state); }, BACKGROUND_INTERVAL_MS);

  await vi.advanceTimersByTimeAsync(1000);
  const follower: Tab = await openTab();
  leader.election.sendHeartbeat(leader.state);
  follower.election.startLeaderElection(follower.state);
  await vi.advanceTimersByTimeAsync(10);
  expect(follower.manager.leaderId).toBe(leader.manager.instanceId);
  return { leader, follower };
}

describe('a leader whose heartbeats the browser throttles', () => {
  it('is never displaced by the foreground follower while it still answers', async () => {
    const { leader, follower } = await backgroundLeaderAndForegroundFollower();

    await vi.advanceTimersByTimeAsync(3 * BACKGROUND_INTERVAL_MS);

    expect(follower.promotions, 'each promotion claimed sessions and opened a socket, only to be demoted').toBe(0);
    expect(follower.manager.isLeader).toBe(false);
    expect(leader.manager.isLeader).toBe(true);
    expect(leader.promotions).toBe(1);
  });

  it('is replaced, once, when it has really gone', async () => {
    const { leader, follower } = await backgroundLeaderAndForegroundFollower();
    leader.reachable = false;

    await vi.advanceTimersByTimeAsync(INTERVAL.LEADER_TIMEOUT_MS + 2 * INTERVAL.HEARTBEAT_MS + INTERVAL.LEADER_CHALLENGE_MS);

    expect(follower.manager.isLeader).toBe(true);
    expect(follower.promotions).toBe(1);
  });
});
