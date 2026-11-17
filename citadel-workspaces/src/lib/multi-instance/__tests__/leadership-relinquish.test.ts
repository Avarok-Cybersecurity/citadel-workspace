/**
 * A leader that cannot serve must yield.
 *
 * Promotion is handled by an `async` listener, and `eventEmitter.emit` invokes
 * handlers SYNCHRONOUSLY — so a rejection from `createWebSocketAsLeader`
 * escaped the emitter's own try/catch and nothing observed it. The tab stayed
 * `isLeader`, kept winning every subsequent election (tryBecomeLeader
 * short-circuits for an existing leader), and answered every request from every
 * tab in the browser with "WebSocket not ready" — permanently. There was no
 * self-demotion path: the yield branch only fires on a competing heartbeat,
 * which never arrives while this tab is broadcasting its own.
 */
import { describe, it, expect, vi, beforeEach  } from 'vitest';

const setLeader: ReturnType<typeof vi.fn> = vi.fn();
let isLeader: boolean = true;
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, {
    get isLeader(): boolean {
      return isLeader;
    },
    instanceId: '1700000000000000123',
    instanceIdAsBigInt: 1700000000000000123n,
    setLeader: (leader: boolean, id: string): void => {
      isLeader = leader;
      setLeader(leader, id);
    },
  }) };
});

const emitted: Array<{ event: string; payload: unknown }> = [];
vi.mock('@/lib/event-emitter', () => ({
  eventEmitter: {
    emit: (event: string, payload: unknown): number => emitted.push({ event, payload }),
    on: () => (): void => {},
  },
}));

import { relinquishLeadership } from '@/lib/multi-instance/channel-leader-election';
import { INTERVAL } from '@/lib/timeout-constants';

function makeState(): { state: never; sent: { type: string; }[]; } {
  const sent: Array<{ type: string }> = [];
  return {
    state: {
      lastLeaderHeartbeat: 0,
      send: (m: { type: string }) => sent.push(m),
    } as never,
    sent,
  };
}

describe('relinquishing leadership', () => {
  beforeEach(() => {
    isLeader = true;
    setLeader.mockClear();
    emitted.length = 0;
  });

  it('stops being leader', () => {
    const { state } = makeState();

    relinquishLeadership(state);

    expect(setLeader).toHaveBeenCalledWith(false, '');
    expect(isLeader).toBe(false);
  });

  it('tells the other tabs, so they re-elect promptly', () => {
    const { state, sent } = makeState();

    relinquishLeadership(state);

    // instance-goodbye makes the others re-elect in ~100ms rather than waiting
    // out the full leader timeout.
    expect(sent.map((m) => m.type)).toContain('instance-goodbye');
  });

  it('announces the change so the socket layer can tear down', () => {
    const { state } = makeState();

    relinquishLeadership(state);

    const change: { event: string; payload: unknown; } | undefined = emitted.find((e): boolean => e.event === 'instance:leader-changed');
    expect(change?.payload).toMatchObject({ isLeader: false });
  });

  it('sets a cooldown so the failing tab does not immediately re-claim', () => {
    const { state } = makeState();

    relinquishLeadership(state);

    // tryBecomeLeader refuses to challenge within LEADER_TIMEOUT_MS of this
    // stamp. Without it the tab that just failed would re-claim, fail again,
    // and spin. Other tabs keep their own clocks and are unaffected.
    const sinceStamp: number = Date.now() - (state as { lastLeaderHeartbeat: number }).lastLeaderHeartbeat;
    expect(sinceStamp).toBeLessThan(INTERVAL.LEADER_TIMEOUT_MS);
  });

  it('does nothing when this tab is not leader', () => {
    isLeader = false;
    const { state, sent } = makeState();

    relinquishLeadership(state);

    expect(setLeader).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
