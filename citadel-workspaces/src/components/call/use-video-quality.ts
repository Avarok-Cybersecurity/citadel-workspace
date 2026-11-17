import { useCallback, useEffect, useState } from 'react';
import {
  parseVideoQuality,
  VIDEO_QUALITY_STORAGE_KEY,
  type VideoQuality,
} from '@/lib/call/video-quality';
import { debugLog } from '@/lib/debug-config';

/**
 * The chosen video quality, remembered between calls.
 *
 * Remembered because the reason somebody picks one rarely changes between
 * calls: a metered connection is metered tomorrow too. Stored in
 * `localStorage` and read through try/catch, because the accessor throws
 * outright under strict privacy settings -- the same hazard round 222 found in
 * its sibling.
 *
 * Applying it to a live call is the caller's job: this owns the preference, not
 * the encoder.
 */
export function useVideoQuality(): {
  quality: VideoQuality;
  setQuality: (next: VideoQuality) => void;
} {
  const [quality, setStoredQuality] = useState<VideoQuality>('auto');

  useEffect(() => {
    try {
      setStoredQuality(parseVideoQuality(localStorage.getItem(VIDEO_QUALITY_STORAGE_KEY)));
    } catch (error) {
      // No storage: the default stands. Not worth telling anybody about --
      // the setting simply will not be remembered, which is the least
      // consequential thing storage denial costs them.
      debugLog('Call', 'video quality preference unavailable', error);
    }
  }, []);

  const setQuality: (next: VideoQuality) => void = useCallback((next: VideoQuality): void => {
    setStoredQuality(next);
    try {
      localStorage.setItem(VIDEO_QUALITY_STORAGE_KEY, next);
    } catch (error) {
      debugLog('Call', 'video quality preference could not be saved', error);
    }
  }, []);

  return { quality, setQuality };
}
