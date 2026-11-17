import type { CallStatus } from '@/lib/call/call-state';

/**
 * Whether the in-call media controls act on anything.
 *
 * A call that failed keeps its stage so the user can read WHY and leave — and
 * the microphone and screen-share buttons were rendered live over it. Pressing
 * screen share on a call that never started opened the browser's screen picker
 * and captured a monitor for nobody; pressing the mic announced a mute to a
 * peer that was never reached.
 *
 * One predicate for all three toggles, because "the call is live" is one fact.
 * The camera already asked it and the other two did not, which is how they
 * came apart.
 */
export interface ControlAvailability {
  usable: boolean;
  /** Present exactly when unusable: a dimmed control that says nothing is a dead end. */
  reason?: string;
}

export function mediaControlsUsable(status: CallStatus): ControlAvailability {
  if (status === 'active' || status === 'connecting') return { usable: true };
  if (status === 'failed') return { usable: false, reason: 'The call never connected' };
  if (status === 'ended') return { usable: false, reason: 'The call has ended' };
  return { usable: false, reason: 'Available once the call connects' };
}

/**
 * Said on the camera control of a call that captured no video.
 *
 * An audio call, or a video call whose camera was blocked and fell back to
 * audio. There is no mid-call upgrade to offer: capture, encoder and the codecs
 * both peers agreed are fixed when the call is placed.
 */
export const NO_CAMERA_IN_CALL: string = 'This call has no camera. Start a video call to use it.';

/**
 * The camera control: usable only while there is a live video track to toggle.
 *
 * It rendered live in an audio call and pressing it did nothing visible --
 * `toggleCamera` refuses when there is no track, and said so only in a toast.
 * A null stream is not judged: capture has not been handed over yet, and the
 * toggle's own check still stands behind the button.
 */
export function cameraControlUsable(status: CallStatus, localStream: MediaStream | null): ControlAvailability {
  const call: ControlAvailability = mediaControlsUsable(status);
  if (!call.usable || localStream === null) return call;
  const live: boolean = localStream.getVideoTracks().some((track: MediaStreamTrack): boolean => track.readyState === 'live');
  return live ? call : { usable: false, reason: NO_CAMERA_IN_CALL };
}
