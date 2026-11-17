/**
 * Liveness: the far side of a call must not depend on a CallEnd arriving.
 *
 * The Playwright flake this guards against: the leaver's call surface clears,
 * but their CallEnd is delayed or lost — a tab closed hard, a network drop —
 * and the other person sits in a dead call with their camera on. These tests
 * drive the REAL wiring (manager → signal handling → liveness binding) with an
 * injected clock, so the far side is proven to end the call on silence alone.
 */
import { describe, it, expect, vi, beforeEach   } from 'vitest';
import { CallManager } from '../call-manager';
import { CALL_HEARTBEAT_TIMEOUT_MS } from '../call-constants';
import type { CallTransport } from '../call-transport';
import type { CallCodecCapabilities, CallMediaKinds, CallSignalPayload } from '@/types/p2p-commands';
import type { CallState } from '@/lib/call/call-state';
import { DIRECT_CALL } from '../call-state';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const CAPS: CallCodecCapabilities = { audio: ['opus'], video: [] };
const BOB: bigint = 2n;
const CAROL: bigint = 3n;
/** Comfortably past CALL_HEARTBEAT_TIMEOUT_MS (20s). */
const SILENT: number = CALL_HEARTBEAT_TIMEOUT_MS + 1_000;

/** Lets already-resolved sends inside fire-and-forget handlers settle. */
const flush: () => Promise<unknown> = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

function harness(): { manager: CallManager; transport: { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn>; sendFrame: ReturnType<typeof vi.fn>; sendSignal: ReturnType<typeof vi.fn>; }; setNow: (ms: number) => void; tick: () => number; heartbeatsTo: (cid: bigint) => number; beat: (from: bigint, callId?: string) => Promise<void>; accept: (from: bigint) => Promise<void>; } {
  let now: number = 0;
  const timers: Array<{ fn: () => void; cancelled: boolean; fired: boolean }> = [];
  const transport: { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn>; sendFrame: ReturnType<typeof vi.fn>; sendSignal: ReturnType<typeof vi.fn> } = {
    openSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    sendFrame: vi.fn(),
    sendSignal: vi.fn().mockResolvedValue(undefined),
  };
  const manager: CallManager = new CallManager({
    transport: transport as unknown as CallTransport,
    selfCid: 1n,
    capabilities: CAPS,
    now: () => now,
    schedule: (fn) => {
      const timer: { fn: () => void; cancelled: boolean; fired: boolean; } = { fn, cancelled: false, fired: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onStateChanged: () => undefined,
    // Named peers, so an assertion about a tile label is about the label and
    // not about whatever the roster happened to hold.
    resolvePeerName: (cid: bigint) => `peer-${cid}`,
    onKeyframeRequested: () => undefined,
  });
  return {
    manager,
    transport,
    setNow: (ms: number): void => {
      now = ms;
    },
    /** Fires every live timer once (each liveness tick re-arms the next). */
    tick: (): number => {
      const due: { fn: () => void; cancelled: boolean; fired: boolean; }[] = timers.filter((t): boolean => !t.cancelled && !t.fired);
      for (const t of due) {
        t.fired = true;
        t.fn();
      }
      return due.length;
    },
    heartbeatsTo: (cid: bigint): number =>
      transport.sendSignal.mock.calls.filter(
        (c) => c[0] === cid && (c[1] as CallSignalPayload).kind === 'CallHeartbeat',
      ).length,
    beat: (from: bigint, callId = 'c1'): Promise<void> =>
      manager.handleSignal(from, from.toString(), { kind: 'CallHeartbeat', call_id: callId }),
    accept: (from: bigint): Promise<void> =>
      manager.handleSignal(from, from.toString(), {
        kind: 'CallAccept',
        call_id: 'c1',
        codecs: CAPS,
        media: AUDIO,
      }),
  };
}
type Harness = ReturnType<typeof harness>;

/** 1:1 call from our side, answered, active — liveness armed at t=0. */
async function activeCall(h: Harness): Promise<void> {
  await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], AUDIO, DIRECT_CALL, null);
  await h.accept(BOB);
  expect(h.manager.getState()?.status).toBe('active');
}

describe('call liveness', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('announces itself to every participant on each tick', async () => {
    await activeCall(h);
    h.tick();
    expect(h.heartbeatsTo(BOB)).toBe(1);
  });

  it('keeps a peer who keeps heart-beating, across more than a full timeout', async () => {
    await activeCall(h);
    // 5s cadence out to 25s: total elapsed exceeds the 20s timeout, so only
    // the refreshed last-seen keeps Bob in.
    for (let t: number = 5_000; t <= 25_000; t += 5_000) {
      h.setNow(t);
      await h.beat(BOB);
      h.tick();
      await flush();
    }
    expect(h.manager.getState()?.status).toBe('active');
    expect(h.manager.getState()?.participants.get(BOB)?.status).toBe('active');
  });

  it('ends a 1:1 call on silence even though CallEnd never arrived', async () => {
    await activeCall(h);
    h.setNow(SILENT);
    h.tick();
    await flush();
    // Exactly the peer-left path: call over, session released, camera freed.
    expect(h.manager.getState()?.status).toBe('ended');
    expect(h.transport.closeSession).toHaveBeenCalledWith(BOB);
  });

  it('counts any signal for the call as presence, not just heartbeats', async () => {
    await activeCall(h);
    h.setNow(15_000);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallMediaState', call_id: 'c1', media: AUDIO });
    h.setNow(SILENT);
    h.tick();
    await flush();
    // A peer toggling media 6s ago is plainly alive.
    expect(h.manager.getState()?.status).toBe('active');
  });

  it('ignores a heartbeat for a call other than the current one', async () => {
    await activeCall(h);
    h.setNow(19_000);
    await h.beat(BOB, 'some-other-call');
    h.setNow(SILENT);
    h.tick();
    await flush();
    // The stale-call heartbeat bought Bob nothing.
    expect(h.manager.getState()?.status).toBe('ended');
  });

  async function activeGroupCall(): Promise<void> {
    await h.manager.start(
      'c1',
      [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }],
      AUDIO,
      { kind: 'group', roomId: 'room-1' },
      null,
    );
    await h.accept(BOB);
    await h.accept(CAROL);
    expect(h.manager.getState()?.status).toBe('active');
  }

  it('drops only the silent peer from a group call; the others carry on', async () => {
    await activeGroupCall();
    h.setNow(SILENT);
    await h.beat(CAROL);
    h.tick();
    await flush();

    const state: CallState | null = h.manager.getState();
    expect(state?.status).toBe('active');
    expect(state?.participants.get(BOB)?.status).toBe('left');
    expect(h.transport.closeSession).toHaveBeenCalledWith(BOB);
    expect(h.transport.closeSession).not.toHaveBeenCalledWith(CAROL);

    // And the next round of heartbeats no longer addresses the departed.
    h.transport.sendSignal.mockClear();
    h.tick();
    expect(h.heartbeatsTo(BOB)).toBe(0);
    expect(h.heartbeatsTo(CAROL)).toBe(1);
  });

  it('does not later report lost a peer who left with a CallEnd', async () => {
    await activeGroupCall();
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallEnd', call_id: 'c1', reason: 'hangup' });
    h.setNow(SILENT);
    await h.beat(CAROL);
    h.tick();
    await flush();
    // One departure, handled once: the session close from the CallEnd, no
    // second teardown from the liveness scan.
    expect(h.transport.closeSession).toHaveBeenCalledTimes(1);
    expect(h.manager.getState()?.status).toBe('active');
  });

  it('stops heart-beating the moment the call ends', async () => {
    await activeCall(h);
    h.tick();
    await h.manager.end('hangup');
    h.transport.sendSignal.mockClear();
    // The re-armed tick was cancelled by the terminal transition; nothing left
    // to fire means nothing keeps running after teardown.
    expect(h.tick()).toBe(0);
    expect(h.heartbeatsTo(BOB)).toBe(0);
  });
});
