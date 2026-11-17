import { VIDEO_PROFILE_MAIN, VIDEO_PROFILE_SCREEN, type VideoProfile } from './codec-support';
import type { VideoQuality } from './video-quality';

/**
 * What each quality level means to the encoder.
 *
 * Separate from `video-quality.ts` because only the encoder needs it, and
 * `video-quality.ts` is reached by the app-wide call provider -- so anything
 * here would be downloaded before the landing page can render. The provider
 * needs the type and the stored preference; the profiles belong with the codec.
 */
/**
 * The camera profile for a chosen quality.
 *
 * `auto` and `high` are the same profile: the difference is that `auto` leaves
 * the congestion ladder free to reduce it, and `high` is the user saying they
 * would rather have the picture. Neither raises anything above what the codec
 * negotiation already agreed.
 */
export function cameraProfileFor(quality: VideoQuality): VideoProfile {
  switch (quality) {
    case 'balanced':
      return { width: 854, height: 480, framerate: 24, bitrate: 600_000 };
    case 'saver':
      return { width: 640, height: 360, framerate: 15, bitrate: 250_000 };
    case 'auto':
    case 'high':
    default:
      return VIDEO_PROFILE_MAIN;
  }
}

/**
 * The shared-screen profile for a chosen quality.
 *
 * A screen degrades differently from a face: resolution is the last thing to
 * give up, because unreadable text is not a smaller version of readable text,
 * it is nothing. So the saver steps carry the frame rate and the bitrate down
 * and leave the pixels alone for as long as they can.
 */
export function screenProfileFor(quality: VideoQuality): VideoProfile {
  switch (quality) {
    case 'balanced':
      return { ...VIDEO_PROFILE_SCREEN, framerate: 5, bitrate: 1_200_000 };
    case 'saver':
      return { width: 1280, height: 720, framerate: 3, bitrate: 600_000 };
    case 'auto':
    case 'high':
    default:
      return VIDEO_PROFILE_SCREEN;
  }
}

/** Whether the congestion ladder may reduce below the chosen profile. */
export function allowsAdaptation(quality: VideoQuality): boolean {
  // Only 'auto' does. Somebody who picked a level picked it, and having the app
  // quietly move off it makes the setting a suggestion -- which is the worst
  // kind of control, because it looks like it did something.
  return quality === 'auto';
}

export const VIDEO_QUALITY_STORAGE_KEY: string = 'citadel-video-quality';

/**
 * Every level, in the order they are offered: most bandwidth first.
 *
 * The ids only. Their labels and explanations live in
 * `video-quality-options.ts`, which the modal imports and nothing else does:
 * the call provider is mounted app-wide, so anything it reaches lands on the
 * landing page's critical path, and forty lines of copy nobody has asked to see
 * yet is exactly the wrong thing to download before the front page renders.
 * That is not hypothetical -- it put the bundle 0.7 KB over budget.
 */
