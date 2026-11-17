/**
 * A media session that never opens must not leave the call sitting in
 * `connecting` for as long as the tab is up.
 *
 * CI reports the group-call spec as this, and only as this:
 *
 *   Expected: "running"
 *   Received: "clock at 00:00, stage says Call connecting"
 *
 * No error panel, no ended call, no clock — sixty seconds of a surface that
 * says the call is on its way. `openSessionFor` retries a REJECTED open on a
 * bounded schedule and gives up. It has no answer at all for an open that
 * never settles: it is awaiting a promise nothing will resolve, so no
 * `peer-connected` arrives, no failure is raised, and the only thing left that
 * can rescue the call is the `connecting` deadline.
 *
 * This pins that the deadline is what it says it is. A user staring at
 * "Connecting…" indefinitely, with the microphone live and no error, is worse
 * than a call that fails: there is nothing to act on, and nothing that says
 * acting is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallManager } from '../call-manager';
import { CONNECT_TIMEOUT_MS } from '../call-constants';
import type { CallTransport } from '../call-transport';
import type { CallCodecCapabilities, CallMediaKinds } from '@/types/p2p-commands';
import { MEDIA_WIRE_VERSION } from '../call-constants';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const CAPS: CallCodecCapabilities = { audio: ['opus'], video: [] };
const ALICE: bigint = 2n;

const flush: () => Promise<unknown> = (): Promise<unknown> =>
  new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  manager: CallManager;
  openSession: ReturnType<typeof vi.fn>;
  setNow: (ms: number) => void;
  tick: () => number;
}

function harness(): Harness {
  let now: number = 0;
  const timers: Array<{ fn: () => void; at: number; cancelled: boolean; fired: boolean }> = [];
  // Never settles. That is the case under test: not a rejection, which the
  // retry policy handles, but an open the service never answers.
  const openSession: ReturnType<typeof vi.fn> = vi.fn(
    (): Promise<void> => new Promise<void>((): void => {}),
  );
  const manager: CallManager = new CallManager({
    transport: {
      openSession,
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendFrame: vi.fn(),
      sendSignal: vi.fn().mockResolvedValue(undefined),
    } as unknown as CallTransport,
    selfCid: 1n,
    capabilities: CAPS,
    now: () => now,
    schedule: (fn, delayMs) => {
      const timer: { fn: () => void; at: number; cancelled: boolean; fired: boolean } = {
        fn, at: now + delayMs, cancelled: false, fired: false,
      };
      timers.push(timer);
      return (): void => { timer.cancelled = true; };
    },
    onStateChanged: () => undefined,
    resolvePeerName: (cid: bigint) => `peer-${cid}`,
    onKeyframeRequested: () => undefined,
  });
  return {
    manager,
    openSession,
    setNow: (ms: number): void => { now = ms; },
    // Only what is actually due, so advancing the clock is what fires a timer
    // rather than calling this.
    tick: (): number => {
      const due: Array<{ fn: () => void; at: number; cancelled: boolean; fired: boolean }> =
        timers.filter((t) => !t.cancelled && !t.fired && t.at <= now);
      for (const t of due) { t.fired = true; t.fn(); }
      return due.length;
    },
  };
}

describe('an accepted call whose media session never opens', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('does not sit in connecting past the connect deadline', async () => {
    await h.manager.handleSignal(ALICE, 'alice', {
      kind: 'CallInvite',
      call_id: 'c1',
      media: AUDIO,
      codecs: CAPS,
      media_wire_version: MEDIA_WIRE_VERSION,
    });
    expect(h.manager.getState()?.status).toBe('ringing-in');

    // `accept` awaits openSessionFor, which awaits an open that never settles,
    // so this promise never resolves either. That is the shape of the bug --
    // hold it, do not await it.
    void h.manager.accept(AUDIO, null);
    await flush();
    expect(h.manager.getState()?.status).toBe('connecting');
    expect(h.openSession).toHaveBeenCalled();

    // One millisecond short: still connecting, which is correct.
    h.setNow(CONNECT_TIMEOUT_MS - 1);
    h.tick();
    await flush();
    expect(h.manager.getState()?.status).toBe('connecting');

    h.setNow(CONNECT_TIMEOUT_MS + 1);
    h.tick();
    await flush();

    expect(h.manager.getState()?.status).not.toBe('connecting');
  });

  it('says the call could not connect, rather than ending quietly', async () => {
    // "Call ended" for a call that never started is the sentence that loses
    // the user the one piece of information they can act on.
    await h.manager.handleSignal(ALICE, 'alice', {
      kind: 'CallInvite',
      call_id: 'c1',
      media: AUDIO,
      codecs: CAPS,
      media_wire_version: MEDIA_WIRE_VERSION,
    });
    void h.manager.accept(AUDIO, null);
    await flush();

    h.setNow(CONNECT_TIMEOUT_MS + 1);
    h.tick();
    await flush();

    expect(h.manager.getState()?.status).toBe('failed');
    expect(h.manager.getState()?.reason).toMatch(/could not connect/i);
  });
});
