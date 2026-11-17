/**
 * The congestion ladder replaced the user's chosen video profile on the first
 * frame of every call.
 *
 * `createVideoEncoder` configures the encoder with the chosen profile, then
 * `encode()` reconfigures whenever `congestion.rung !== appliedRung`.
 * `appliedRung` starts at -1 and `INITIAL_CONGESTION.rung` is 0, so that is true
 * for the very first frame — before any congestion has been observed at all.
 *
 * The ladder's rungs are ABSOLUTE, not relative to the profile. Rung 0 is
 * `{ height: 720, framerate: 30 }`. So:
 *
 *   - "Saver" (640×360 @15fps) became 640×720 @30fps — a broken aspect ratio at
 *     double the chosen frame rate, still capped at 250 kbps.
 *   - "Balanced" (854×480 @24fps) became 854×720 @30fps.
 *   - The saver SCREEN profile (1280×720 @3fps) became @30fps — ten times the
 *     frame rate chosen precisely to keep a shared screen cheap.
 *
 * `allowsAdaptation` does not prevent this. It gates `applyQualityReport`, so
 * for a non-auto quality the congestion state never MOVES — but rung 0 is still
 * applied over the profile on frame one, and never revisited. A control that
 * looks like it protects the setting and does not.
 *
 * Note `width` was left at `profile.width` while `height` came from the rung,
 * so every degrade also distorted the picture.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { INITIAL_CONGESTION, type CongestionState } from '../congestion';
import type { VideoEncoderHandle } from '../media-pipeline';
import type { VideoProfile } from '../codec-support';
import { cameraProfileFor, screenProfileFor } from '../video-quality-profiles';

interface Config { width: number; height: number; framerate: number; bitrate: number }

const configs: Config[] = [];

class StubVideoEncoder {
  state: string = 'configured';
  constructor(_init: unknown) { void _init; }
  configure(config: Config): void { configs.push({ ...config }); }
  encode(_frame: unknown, _opts: unknown): void { void _frame; void _opts; }
  close(): void { this.state = 'closed'; }
  queueSize(): number { return 0; }
}

vi.stubGlobal('VideoEncoder', StubVideoEncoder);

const { createVideoEncoder }: typeof import('../media-pipeline') = await import('../media-pipeline');

const CODEC: never = 'vp8' as never;
const frame: never = { timestamp: 0 } as never;

interface Built { handle: VideoEncoderHandle; profile: VideoProfile }

function encoderFor(quality: 'saver' | 'balanced' | 'high', screen?: { track: number }): Built {
  const profile: VideoProfile = screen ? screenProfileFor(quality) : cameraProfileFor(quality);
  const handle: VideoEncoderHandle = createVideoEncoder(
    CODEC, false, false, () => {}, () => {}, screen, profile,
  );
  return { handle, profile };
}

describe('the congestion ladder', () => {
  beforeEach((): void => { configs.length = 0; });

  it('does not reconfigure at all on the first frame of an uncongested call', () => {
    const { profile }: Built = encoderFor('saver');
    const initial: number = configs.length;
    expect(initial).toBe(1);
    expect(configs[0].height).toBe(profile.height);

    encoderFor('saver').handle.encode(frame, INITIAL_CONGESTION);

    // One configure for THIS encoder's construction, and none from encode().
    // A reconfigure here is the defect: nothing has been observed yet.
    expect(configs.length).toBe(2);
  });

  it('never raises the chosen profile when it degrades', () => {
    const { handle, profile }: Built = encoderFor('saver');
    configs.length = 0;

    // Every rung of the ladder, including rung 0.
    for (let rung: number = 0; rung < 5; rung++) {
      handle.encode(frame, { rung, cleanStreak: 0 } as CongestionState);
    }

    for (const config of configs) {
      expect(config.height).toBeLessThanOrEqual(profile.height);
      expect(config.framerate).toBeLessThanOrEqual(profile.framerate);
      expect(config.bitrate).toBeLessThanOrEqual(profile.bitrate);
    }
  });

  it('keeps the aspect ratio the profile asked for', () => {
    const { handle, profile }: Built = encoderFor('balanced');
    configs.length = 0;

    handle.encode(frame, { rung: 3, cleanStreak: 0 } as CongestionState);

    expect(configs.length).toBeGreaterThan(0);
    const chosen: number = profile.width / profile.height;
    for (const config of configs) {
      // Within a pixel of rounding on each axis.
      expect(config.width / config.height).toBeCloseTo(chosen, 1);
    }
  });

  it('leaves a shared screen at the frame rate the saver chose', () => {
    // A screen at 3fps is a deliberate choice; 30fps is ten times the bandwidth
    // for content that barely moves.
    const { handle, profile }: Built = encoderFor('saver', { track: 2 });
    configs.length = 0;

    handle.encode(frame, INITIAL_CONGESTION);
    handle.encode(frame, { rung: 2, cleanStreak: 0 } as CongestionState);

    for (const config of configs) {
      expect(config.framerate).toBeLessThanOrEqual(profile.framerate);
    }
  });

  it('still degrades — the cap must not make the ladder inert', () => {
    // The opposite failure: clamping everything to the profile would produce a
    // ladder that never reduces anything, which reads as "protected" and is not.
    const { handle }: Built = encoderFor('high');
    configs.length = 0;

    handle.encode(frame, { rung: 4, cleanStreak: 0 } as CongestionState);

    expect(configs.length).toBe(1);
    const worst: Config = configs[0];
    const { profile }: Built = encoderFor('high');
    expect(worst.bitrate).toBeLessThan(profile.bitrate);
    expect(worst.height).toBeLessThan(profile.height);
  });
});
