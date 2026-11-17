/**
 * How much bandwidth this person wants their video to cost.
 *
 * A call that stutters is worse than a call that looks soft, and only the
 * person on it knows which they are living with: a hotel wifi, a phone
 * tethering, a metered connection where the bill is the constraint. The encoder
 * already backs off under measured congestion, but that is a reaction to
 * trouble already happening — this is the ceiling somebody sets before it does.
 *
 * `auto` is the default and means "whatever the connection can carry": the full
 * profile, with the existing congestion ladder free to move underneath it.
 */
export type VideoQuality = 'auto' | 'high' | 'balanced' | 'saver';

/**
 * Every level, most bandwidth first. The ids only.
 *
 * Their labels and explanations are in `video-quality-options.ts` and their
 * encoder profiles in `video-quality-profiles.ts`, both imported by exactly one
 * consumer. This module is reached by the app-wide call provider, so everything
 * left in it is downloaded before the landing page renders.
 */
export const VIDEO_QUALITY_IDS: readonly VideoQuality[] = ['auto', 'high', 'balanced', 'saver'];

export const VIDEO_QUALITY_STORAGE_KEY: string = 'citadel-video-quality';

/** Parse a stored value, refusing anything that is not one of the options. */
export function parseVideoQuality(stored: string | null): VideoQuality {
  return VIDEO_QUALITY_IDS.includes((stored ?? '') as VideoQuality)
    ? (stored as VideoQuality)
    : 'auto';
}
