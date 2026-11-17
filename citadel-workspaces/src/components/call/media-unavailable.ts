/**
 * What to say when a media control cannot do what it says.
 *
 * Each of these replaces a success the UI would otherwise report:
 *
 *  - pressing "turn camera on" when capture never got a video track used to
 *    flip the button and announce `video: true` to every peer, with no frame
 *    ever sent;
 *  - the same for the microphone, reachable by unplugging one mid-call — its
 *    track ends, and unmuting an ended track is a no-op that still announced
 *    "unmuted";
 *  - a screen share ended from the browser's own bar, which this app does not
 *    own and cannot hide. Said out loud, or the button going back on its own
 *    reads as a glitch.
 */
export const CAMERA_UNAVAILABLE: string =
  'Your camera is not available for this call. Rejoin to try again.';

export const MIC_UNAVAILABLE: string =
  'Your microphone is not available for this call. Rejoin to try again.';

export const SCREEN_SHARE_STOPPED: string = 'Screen sharing stopped.';
