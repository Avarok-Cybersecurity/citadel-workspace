/**
 * Call sound policy: what rings, when, and — mostly — when it must stop.
 *
 * The rules live here with all I/O injected (audio, timers, the cross-tab
 * lock), because the rules are what break: two rings at once, a ring that
 * survives a decline, a burst that fires after the call ended. Each of those
 * is a test against a fake, not a bug report. The actual sound comes from
 * call-sound-synth.ts, synthesized with the Web Audio API — no audio assets,
 * no licences, nothing added to any bundle.
 */

import { playTones, type ToneSpec } from './call-sound-synth';
import { loadCallSoundSettings } from './call-sound-preferences';

export type RingKind = 'incoming' | 'ringback';
export type ChimeKind = 'connected' | 'ended';

interface RingSpec {
  tone: ToneSpec;
  /** Full cadence cycle; the gap is periodMs minus the tone's duration. */
  periodMs: number;
}

/** Every frequency, cadence and level in one table (SSOT for the synth too). */
const RING_SPECS: Record<RingKind, RingSpec> = {
  // The classic dual-tone ring, 2s on / 4s off: instantly readable as "a call".
  incoming: { tone: { freqsHz: [440, 480], atMs: 0, durationMs: 2000, gain: 0.08 }, periodMs: 6000 },
  // Quieter and shorter for the caller, who already knows a call is happening.
  ringback: { tone: { freqsHz: [440, 480], atMs: 0, durationMs: 1500, gain: 0.035 }, periodMs: 5000 },
};

const CHIME_SPECS: Record<ChimeKind, ToneSpec[]> = {
  connected: [
    { freqsHz: [660], atMs: 0, durationMs: 140, gain: 0.06 },
    { freqsHz: [880], atMs: 150, durationMs: 200, gain: 0.06 },
  ],
  ended: [
    { freqsHz: [440], atMs: 0, durationMs: 140, gain: 0.05 },
    { freqsHz: [330], atMs: 150, durationMs: 220, gain: 0.05 },
  ],
};

export interface CallSoundDeps {
  playRing: (spec: RingSpec['tone']) => void;
  playChime: (tones: ToneSpec[]) => void;
  isEnabled: () => boolean;
  /**
   * Cross-tab exclusivity: resolves with a release function while this tab may
   * ring, or null when another tab already rings for this call.
   */
  acquireRingLock: (callId: string) => Promise<(() => void) | null>;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

export interface CallSoundPlayer {
  startRing: (kind: RingKind, callId: string) => Promise<void>;
  stopRing: () => void;
  chime: (kind: ChimeKind) => void;
  isRinging: () => boolean;
}

interface ActiveRing {
  callId: string;
  kind: RingKind;
  timer: number | null;
  release: (() => void) | null;
}

export function createCallSoundPlayer(deps: CallSoundDeps): CallSoundPlayer {
  let active: ActiveRing | null = null;
  // Bumped on every start/stop so a lock acquired for a ring that was since
  // stopped is released instead of ringing a call that no longer exists.
  let generation: number = 0;

  const stopRing = (): void => {
    generation += 1;
    if (!active) return;
    if (active.timer !== null) deps.clearTimer(active.timer);
    active.release?.();
    active = null;
  };

  const startRing = async (kind: RingKind, callId: string): Promise<void> => {
    if (!deps.isEnabled()) return;
    if (active && active.callId === callId && active.kind === kind) return;
    stopRing();
    const gen: number = ++generation;
    const release: (() => void) | null = await deps.acquireRingLock(callId);
    if (gen !== generation) {
      release?.();
      return;
    }
    if (!release) return; // Another tab is already ringing this call.

    const spec: RingSpec = RING_SPECS[kind];
    const ring: ActiveRing = { callId, kind, timer: null, release };
    active = ring;
    const tick = (): void => {
      deps.playRing(spec.tone);
      ring.timer = deps.setTimer(tick, spec.periodMs);
    };
    tick();
  };

  return {
    startRing,
    stopRing,
    chime: (kind): void => {
      if (deps.isEnabled()) deps.playChime(CHIME_SPECS[kind]);
    },
    isRinging: () => active !== null,
  };
}

/**
 * One tab per call may ring, enforced with the Web Locks API. Browsers without
 * it simply ring — a duplicated ring in an exotic browser beats a silent call.
 */
function acquireRingLock(callId: string): Promise<(() => void) | null> {
  const locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    locks
      .request(`citadel:call-ring:${callId}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        // The lock is held until the resolved release function is called.
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(() => resolve(() => {}));
  });
}

let defaultPlayer: CallSoundPlayer | null = null;

/** The app-wide player, wired to Web Audio, real timers and the tab lock. */
export function callSounds(): CallSoundPlayer {
  defaultPlayer ??= createCallSoundPlayer({
    playRing: (tone) => playTones([tone]),
    playChime: (tones) => playTones(tones),
    isEnabled: () => loadCallSoundSettings().enabled,
    acquireRingLock,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });
  return defaultPlayer;
}
