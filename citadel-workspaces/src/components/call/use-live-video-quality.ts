import { useCallback, useEffect , type MutableRefObject } from 'react';
import { useVideoQuality } from './use-video-quality';
import type { VideoQuality } from '@/lib/call/video-quality';

interface SessionLike {
  setVideoQuality: (quality: VideoQuality) => void;
}

/**
 * The chosen quality, kept and applied to whatever call is live.
 *
 * Two halves that have to stay together, which is why they are here rather than
 * spread across the provider: the preference outlives any one call, and the
 * session that has to honour it appears and disappears underneath it.
 *
 * The effect re-runs on a new call id as well as on a change of setting,
 * because the case people actually hit is choosing a lower quality *because the
 * last call was rough* and then starting another one. A preference that only
 * applied to the call it was set during would be silently useless in exactly
 * that moment.
 */
export function useLiveVideoQuality(
  sessionRef: MutableRefObject<SessionLike | null>,
  callId: string | undefined,
): { videoQuality: VideoQuality; setVideoQuality: (next: VideoQuality) => void } {
  const { quality, setQuality } = useVideoQuality();

  useEffect(() => {
    sessionRef.current?.setVideoQuality(quality);
  }, [quality, callId, sessionRef]);

  const setVideoQuality: (next: VideoQuality) => void = useCallback(
    (next: VideoQuality): void => {
      setQuality(next);
      // Applied now as well as by the effect: the effect runs after the render,
      // and a control that takes a frame to do anything reads as a control that
      // did not work.
      sessionRef.current?.setVideoQuality(next);
    },
    [setQuality, sessionRef],
  );

  return { videoQuality: quality, setVideoQuality };
}
