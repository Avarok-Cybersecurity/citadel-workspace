/**
 * The failure modes that matter for call audio: two rings at once, a ring that
 * survives a decline, a burst firing after stop, sound in a tab that lost the
 * ring lock. All I/O is injected (SBIO), so the fakes here stand in only for
 * hardware audio and cross-tab locks — neither exists under jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCallSoundPlayer, type CallSoundDeps } from '../call-sounds';
import { playTones } from '../call-sound-synth';
import type { CallSoundPlayer } from '@/lib/call/call-sounds';

interface Harness {
  deps: CallSoundDeps;
  bursts: Array<{ freqsHz: number[]; durationMs: number }>;
  chimes: number;
  fireTimers: () => void;
  activeTimerCount: () => number;
  locksHeld: () => number;
}

function harness(overrides: Partial<CallSoundDeps> = {}): Harness {
  const bursts: Harness['bursts'] = [];
  let chimes: number = 0;
  const timers: Map<number, () => void> = new Map<number, () => void>();
  let nextId: number = 1;
  let held: number = 0;
  const deps: CallSoundDeps = {
    playRing: (tone) => bursts.push({ freqsHz: tone.freqsHz, durationMs: tone.durationMs }),
    playChime: () => {
      chimes += 1;
    },
    isEnabled: () => true,
    acquireRingLock: () => {
      held += 1;
      return Promise.resolve(() => {
        held -= 1;
      });
    },
    setTimer: (fn) => {
      const id: number = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    ...overrides,
  };
  return {
    deps,
    bursts,
    get chimes(): number {
      return chimes;
    },
    fireTimers: (): void => {
      const pending: [number, () => void][] = [...timers.entries()];
      timers.clear();
      for (const [, fn] of pending) fn();
    },
    activeTimerCount: () => timers.size,
    locksHeld: () => held,
  };
}

describe('createCallSoundPlayer', () => {
  it('plays a burst immediately and again each cadence period', async () => {
    const h: Harness = harness();
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    await player.startRing('incoming', 'call-1');
    expect(h.bursts).toHaveLength(1);
    expect(h.bursts[0].freqsHz).toEqual([440, 480]);

    h.fireTimers();
    expect(h.bursts).toHaveLength(2);
  });

  it('uses a quieter, shorter burst for the caller ringback than the incoming ring', async () => {
    const h: Harness = harness();
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    await player.startRing('incoming', 'call-1');
    player.stopRing();
    await player.startRing('ringback', 'call-2');

    expect(h.bursts[1].durationMs).toBeLessThan(h.bursts[0].durationMs);
  });

  it('stops immediately: no further bursts and the cross-tab lock is released', async () => {
    const h: Harness = harness();
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    await player.startRing('incoming', 'call-1');
    expect(h.locksHeld()).toBe(1);

    player.stopRing();
    expect(h.locksHeld()).toBe(0);
    expect(h.activeTimerCount()).toBe(0);
    h.fireTimers();
    expect(h.bursts).toHaveLength(1);
    expect(player.isRinging()).toBe(false);
  });

  it('never rings twice at once: a new ring replaces the old one', async () => {
    const h: Harness = harness();
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    await player.startRing('incoming', 'call-1');
    await player.startRing('ringback', 'call-2');

    expect(h.locksHeld()).toBe(1);
    // Only the new ring's timer survives; firing it plays exactly one burst.
    const before: number = h.bursts.length;
    h.fireTimers();
    expect(h.bursts.length).toBe(before + 1);
  });

  it('is idempotent for the same call and kind, so re-renders do not restart the cadence', async () => {
    const h: Harness = harness();
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    await player.startRing('incoming', 'call-1');
    await player.startRing('incoming', 'call-1');

    expect(h.bursts).toHaveLength(1);
    expect(h.locksHeld()).toBe(1);
  });

  it('stays silent when the preference is off', async () => {
    const h: Harness = harness({ isEnabled: () => false });
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    await player.startRing('incoming', 'call-1');
    player.chime('connected');

    expect(h.bursts).toHaveLength(0);
    expect(h.chimes).toBe(0);
  });

  it('stays silent when another tab already rings this call', async () => {
    const h: Harness = harness({ acquireRingLock: () => Promise.resolve(null) });
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    await player.startRing('incoming', 'call-1');

    expect(h.bursts).toHaveLength(0);
    expect(player.isRinging()).toBe(false);
  });

  it('releases a lock that resolves after the ring was already stopped', async () => {
    let held: number = 0;
    let grant: ((release: (() => void) | null) => void) | undefined;
    const h: Harness = harness({
      acquireRingLock: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    });
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    const started: Promise<void> = player.startRing('incoming', 'call-1');
    player.stopRing();
    held = 1;
    grant?.(() => {
      held = 0;
    });
    await started;

    expect(held).toBe(0);
    expect(h.bursts).toHaveLength(0);
  });

  it('plays chimes when enabled', async () => {
    const h: Harness = harness();
    const player: CallSoundPlayer = createCallSoundPlayer(h.deps);

    player.chime('connected');
    player.chime('ended');

    expect(h.chimes).toBe(2);
  });
});

describe('playTones (autoplay / missing audio hardware)', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('does not throw when the browser has no AudioContext (jsdom has none)', () => {
    expect(() =>
      playTones([{ freqsHz: [440], atMs: 0, durationMs: 100, gain: 0.05 }]),
    ).not.toThrow();
  });

  it('does not throw or reject when the context stays suspended (autoplay refused)', async () => {
    const fakeCtx: { state: string; currentTime: number; resume: () => Promise<never>; } = {
      state: 'suspended',
      currentTime: 0,
      resume: (): Promise<never> => Promise.reject(new Error('autoplay blocked')),
    };
    vi.stubGlobal('AudioContext', function AudioContext() {
      return fakeCtx;
    });

    expect(() =>
      playTones([{ freqsHz: [440], atMs: 0, durationMs: 100, gain: 0.05 }]),
    ).not.toThrow();
    // Let the rejected resume() settle: an unhandled rejection would fail here.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
