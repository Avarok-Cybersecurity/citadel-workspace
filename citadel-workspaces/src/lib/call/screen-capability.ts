import { trackProcessor } from './track-transforms';

/**
 * Whether this browser can share a screen at all.
 *
 * Its own module because the call provider is mounted app-wide and asks this on
 * every render: importing it from `capture-pump` pulled both pumps, their canvas
 * fallback and the whole WebCodecs path onto the landing page's critical path,
 * for the sake of two feature checks. That is how a bundle budget goes over by
 * half a kilobyte with nothing visibly changing.
 */
export function canShareScreen(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    trackProcessor() !== null
  );
}
