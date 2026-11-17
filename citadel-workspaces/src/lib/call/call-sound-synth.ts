/**
 * The Web Audio rendering layer for call sounds.
 *
 * Tones are synthesized rather than sampled: a few oscillator lines replace an
 * audio asset pipeline entirely — nothing to license, nothing to download,
 * nothing on the bundle. This module holds ALL the audio I/O so the cadence
 * and policy logic in call-sounds.ts stays pure and testable.
 *
 * Nothing here may ever throw. Sound is a nicety layered over a call that must
 * keep working when the browser's autoplay policy refuses playback.
 */

export interface ToneSpec {
  /** Oscillators mixed together, e.g. the classic 440 + 480 Hz ring pair. */
  freqsHz: number[];
  /** Offset from "now", letting a chime sequence two notes in one call. */
  atMs: number;
  durationMs: number;
  /** Peak gain, kept well below 1: these play over an active conversation. */
  gain: number;
}

/** Attack/release ramp so tones start and stop without an audible click. */
const RAMP_S: number = 0.015;

let ctx: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  ctx ??= new window.AudioContext();
  return ctx;
}

function scheduleTone(c: AudioContext, tone: ToneSpec): void {
  const start: number = c.currentTime + tone.atMs / 1000;
  const end: number = start + tone.durationMs / 1000;
  const envelope: ReturnType<typeof c.createGain> = c.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(tone.gain, start + RAMP_S);
  envelope.gain.setValueAtTime(tone.gain, Math.max(start + RAMP_S, end - RAMP_S));
  envelope.gain.linearRampToValueAtTime(0, end);
  envelope.connect(c.destination);

  for (const freqHz of tone.freqsHz) {
    const osc: ReturnType<typeof c.createOscillator> = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freqHz;
    osc.connect(envelope);
    osc.onended = (): void => {
      osc.disconnect();
      envelope.disconnect();
    };
    osc.start(start);
    osc.stop(end + RAMP_S);
  }
}

/**
 * Play a set of tones now. Silently does nothing when audio is unavailable or
 * blocked by autoplay policy — the call itself must not notice either way.
 */
export function playTones(tones: ToneSpec[]): void {
  try {
    const c: AudioContext | null = ensureContext();
    if (!c) return;
    // A suspended context means no user gesture has unlocked audio yet. The
    // tones are only valid within their own window: if resume() resolves later
    // than that (or never), playing a stale burst would ring after the call
    // stopped ringing, so it is dropped instead.
    const staleAfter: number = Date.now() + Math.max(...tones.map((t) => t.atMs + t.durationMs));
    const go = (): void => {
      if (Date.now() > staleAfter) return;
      try {
        for (const tone of tones) scheduleTone(c, tone);
      } catch {
        // A failed nicety stays a nicety.
      }
    };
    if (c.state === 'running') go();
    else c.resume().then(go, () => {});
  } catch {
    // Never let sound break a call.
  }
}
