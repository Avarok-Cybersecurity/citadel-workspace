/**
 * An invitee who never answers must not keep a call alive forever.
 *
 * `active` deliberately has no status deadline — the heartbeat watchdog owns
 * it. But that watchdog only tracks peers who are `active` or `connecting`, and
 * an invitee who never answers is neither: `invite-sent` seeds them `'invited'`
 * and nothing aged that out once the call left `ringing-out`.
 *
 * They then blocked BOTH end conditions — `anyoneActive` is false (invited is
 * not active or connecting) and `everyoneGone` is false (invited is not left or
 * declined). So when the last real participant hung up, the call stayed
 * `active` with nobody in it: stage docked, duration ticking, CAMERA LIGHT ON,
 * and the phantom tile still rendered. Leave still worked — but only if the
 * user noticed.
 *
 * Drives the real manager and its real liveness binding with an injected clock.
 */
import { describe, it, expect, vi, beforeEach   } from 'vitest';
import { CallManager } from '../call-manager';
import { RING_TIMEOUT_MS } from '../call-constants';
import type { CallTransport } from '../call-transport';
import type { CallCodecCapabilities, CallMediaKinds } from '@/types/p2p-commands';
import { DIRECT_CALL } from '../call-state';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const CAPS: CallCodecCapabilities = { audio: ['opus'], video: [] };
const BOB: bigint = 2n;
const CAROL: bigint = 3n;

const flush: () => Promise<unknown> = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

function harness(): { manager: CallManager; transport: { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn>; sendFrame: ReturnType<typeof vi.fn>; sendSignal: ReturnType<typeof vi.fn>; }; setNow: (ms: number) => void; tick: () => number; accept: (from: bigint) => Promise<void>; beat: (from: bigint) => Promise<void>; bye: (from: bigint) => Promise<void>; } {
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
    resolvePeerName: (cid: bigint) => `peer-${cid}`,
    onKeyframeRequested: () => undefined,
  });
  return {
    manager,
    transport,
    setNow: (ms: number): void => {
      now = ms;
    },
    tick: (): number => {
      const due: { fn: () => void; cancelled: boolean; fired: boolean; }[] = timers.filter((t): boolean => !t.cancelled && !t.fired);
      for (const t of due) {
        t.fired = true;
        t.fn();
      }
      return due.length;
    },
    accept: (from: bigint): Promise<void> =>
      manager.handleSignal(from, from.toString(), {
        kind: 'CallAccept',
        call_id: 'c1',
        codecs: CAPS,
        media: AUDIO,
      }),
    beat: (from: bigint): Promise<void> =>
      manager.handleSignal(from, from.toString(), { kind: 'CallHeartbeat', call_id: 'c1' }),
    bye: (from: bigint): Promise<void> =>
      manager.handleSignal(from, from.toString(), {
        kind: 'CallEnd',
        call_id: 'c1',
        reason: 'hangup',
      }),
  };
}
type Harness = ReturnType<typeof harness>;

/** Bob and Carol invited; Bob answers, Carol's tab is closed and never will. */
async function groupCallWithOneStraggler(h: Harness): Promise<void> {
  await h.manager.start(
    'c1',
    [
      { cid: BOB, username: 'bob' },
      { cid: CAROL, username: 'carol' },
    ],
    AUDIO,
    DIRECT_CALL,
    null
  );
  await h.accept(BOB);
  expect(h.manager.getState()?.status).toBe('active');
  expect(h.manager.getState()?.participants.get(CAROL)?.status).toBe('invited');
}

describe('an invitee who never answers', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('does not keep the call alive after everyone else has left', async () => {
    await groupCallWithOneStraggler(h);

    await h.bye(BOB);
    await flush();

    // Before the fix the call sat here at 'active' forever, with the camera on.
    h.setNow(RING_TIMEOUT_MS + 1_000);
    h.tick();
    await flush();

    expect(h.manager.getState()?.status).toBe('ended');
  });

  it('is given the full ring timeout before being written off', async () => {
    await groupCallWithOneStraggler(h);

    // Someone genuinely still ringing must get their chance to answer.
    h.setNow(RING_TIMEOUT_MS - 1_000);
    h.tick();
    await flush();

    expect(h.manager.getState()?.participants.get(CAROL)?.status).toBe('invited');
    expect(h.manager.getState()?.status).toBe('active');
  });

  it('leaves a call alone while someone is actually in it', async () => {
    await groupCallWithOneStraggler(h);

    // Carol expires, but Bob is still here — the call must continue.
    //
    // Bob has to heartbeat: RING_TIMEOUT_MS (45s) is well past
    // CALL_HEARTBEAT_TIMEOUT_MS (20s), so a silent Bob is legitimately dropped
    // by the watchdog and the assertion would be about silence, not about
    // Carol. The first version of this test asserted Bob was 'active' and got
    // 'left' for exactly that reason.
    h.setNow(RING_TIMEOUT_MS + 1_000);
    await h.beat(BOB);
    h.tick();
    await flush();

    expect(h.manager.getState()?.status).toBe('active');
    expect(h.manager.getState()?.participants.get(BOB)?.status).toBe('active');
  });
});
