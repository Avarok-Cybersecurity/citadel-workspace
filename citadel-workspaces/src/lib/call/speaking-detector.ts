/**
 * Decides when a participant counts as speaking, from audio levels.
 *
 * Pure by design: the reducer, the `speaking` state field and the ring in
 * ParticipantTile all existed, and nothing ever dispatched `speaking-changed`,
 * so the indicator could not appear for anyone. Keeping the decision separate
 * from the Web Audio plumbing is what makes it testable at all -- the capture
 * side needs a real `AudioData` and a browser.
 *
 * Two properties matter and neither is obvious from a single threshold:
 *
 * - **Hysteresis.** One level to start speaking, a lower one to stop. With a
 *   single threshold a voice sitting near it flickers the ring on and off many
 *   times a second.
 * - **Hold.** Ordinary speech has gaps between words that fall below any
 *   sensible floor. Dropping the indicator during them makes it strobe, so the
 *   `on` state persists for `SPEAKING_HOLD_MS` after the last loud sample.
 *
 * `observe` returns the new value only when it CHANGES, and null otherwise, so
 * a caller cannot turn a per-audio-frame signal into a per-audio-frame event.
 */

/** Root-mean-square level at which speech starts counting. */
export const SPEAKING_ON_RMS: number = 0.02;

/** The lower level it must fall below to stop counting. */
export const SPEAKING_OFF_RMS: number = 0.01;

/** How long `on` persists after the last sample above the start level. */
export const SPEAKING_HOLD_MS: number = 400;

export interface SpeakingDetector {
  /** The new value if it changed, or null. */
  observe(rms: number, now: number): boolean | null;
}

export function createSpeakingDetector(): SpeakingDetector {
  let speaking: boolean = false;
  let lastLoud: number = Number.NEGATIVE_INFINITY;

  return {
    observe(rms: number, now: number): boolean | null {
      if (rms >= SPEAKING_ON_RMS) {
        lastLoud = now;
        if (!speaking) {
          speaking = true;
          return true;
        }
        return null;
      }

      if (speaking && rms < SPEAKING_OFF_RMS && now - lastLoud >= SPEAKING_HOLD_MS) {
        speaking = false;
        return false;
      }

      return null;
    },
  };
}

/**
 * Root-mean-square of a block of samples.
 *
 * Not peak: a single click reaches full scale and says nothing about whether
 * anyone is talking, while RMS tracks sustained energy the way a level meter
 * does.
 */
export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum: number = 0;
  for (let i: number = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}
