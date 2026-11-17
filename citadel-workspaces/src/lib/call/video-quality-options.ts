import type { VideoQuality } from './video-quality';

/**
 * What each quality level is called, and what it costs.
 *
 * Separate from `video-quality.ts` because that module is reached by the call
 * provider, which is mounted app-wide -- so anything in it is downloaded before
 * the landing page can render. This is copy for a modal nobody has opened yet,
 * and it put the critical path 0.7 KB over budget.
 */
export interface QualityOption {
  id: VideoQuality;
  label: string;
  /** What it means in plain words, not in codec terms. */
  detail: string;
  /** Roughly what it costs, so the choice can be made on the thing that matters. */
  approxBitrate: string;
}

/**
 * In the order they are offered: most bandwidth first.
 *
 * Ordered that way because the list reads as a slider from "best picture" to
 * "smallest", which is how somebody thinks about it. `auto` sits at the top as
 * the recommendation rather than at the end as an afterthought.
 */
export const VIDEO_QUALITY_OPTIONS: readonly QualityOption[] = [
  {
    id: 'auto',
    label: 'Automatic',
    detail: 'Adjusts to the connection. Best for most calls.',
    approxBitrate: 'up to 1.2 Mbps',
  },
  {
    id: 'high',
    label: 'High detail',
    detail: 'Sharpest picture. Needs a stable connection.',
    approxBitrate: '~1.2 Mbps',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    detail: 'Smaller picture, steadier motion on a busy network.',
    approxBitrate: '~600 kbps',
  },
  {
    id: 'saver',
    label: 'Data saver',
    detail: 'Lowest bandwidth. Faces stay recognisable; fine detail will not.',
    approxBitrate: '~250 kbps',
  },
];
