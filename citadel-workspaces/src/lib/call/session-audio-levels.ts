/**
 * Turns captured `AudioData` into speaking/not-speaking changes.
 *
 * Split from CallSession because it is the only part of the speaking indicator
 * that needs WebCodecs: the decision itself is pure and lives in
 * `speaking-detector`, and keeping the two apart is what lets the thresholds be
 * tested without a browser.
 */
import { createSpeakingDetector, rmsOf, type SpeakingDetector } from './speaking-detector';
import { debugLog } from '@/lib/debug-config';

export interface AudioLevelReporter {
  /** Measures one block. Calls back only when the state CHANGES. */
  observe(data: AudioData): void;
}

export function createAudioLevelReporter(
  onSpeakingChanged: (speaking: boolean) => void,
): AudioLevelReporter {
  const detector: SpeakingDetector = createSpeakingDetector();
  /** Reused across blocks; copyTo allocates otherwise, tens of times a second. */
  let scratch: Float32Array | null = null;
  /** Set if copyTo throws once, so a bad format does not log per block. */
  let unavailable: boolean = false;

  return {
    observe(data: AudioData): void {
      if (unavailable) return;
      try {
        const bytes: number = data.allocationSize({ planeIndex: 0, format: 'f32-planar' });
        const samples: number = bytes / Float32Array.BYTES_PER_ELEMENT;
        if (scratch === null || scratch.length < samples) {
          scratch = new Float32Array(samples);
        }
        const block: Float32Array = scratch.subarray(0, samples);
        data.copyTo(block, { planeIndex: 0, format: 'f32-planar' });
        const changed: boolean | null = detector.observe(rmsOf(block), Date.now());
        if (changed !== null) onSpeakingChanged(changed);
      } catch (error) {
        // A format this browser will not hand us as f32-planar. The call is
        // unaffected -- only the indicator is -- so this stops trying rather
        // than failing the call, and says so once.
        unavailable = true;
        debugLog('CallSession', 'Audio levels unavailable; speaking indicator disabled:', error);
      }
    },
  };
}
