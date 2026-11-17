/**
 * Microphone and camera acquisition.
 *
 * Almost all of this file is failure handling, and that is the point. Getting a
 * stream is one line; the states around it — permission blocked at the OS level,
 * blocked in the browser, no camera present, a device unplugged mid-call,
 * another app holding the camera — are what the user actually encounters, and
 * each one looks like "the call is broken" unless it is named.
 */

import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from './codec-support';

export type CaptureFailureKind =
  | 'permission-denied'
  | 'no-device'
  | 'device-in-use'
  | 'insecure-context'
  | 'unsupported'
  /** A device that WAS working stopped mid-call: unplugged, or revoked. */
  | 'device-lost'
  | 'unknown';

export interface CaptureFailure {
  kind: CaptureFailureKind;
  /** Shown to the user. Says what happened and what to do about it. */
  message: string;
  /** True when retrying could plausibly work — drives whether we offer a retry. */
  retryable: boolean;
}

export interface CaptureRequest {
  audio: boolean;
  video: boolean;
}

export type CaptureResult =
  /**
   * `degraded` is set when video was asked for and could not be captured, but
   * audio could. The call is worth having, so `ok` stays true — but it used to
   * be the ONLY signal, which meant a user whose camera was blocked joined a
   * video call with no self-video and no explanation at all. The caller is
   * expected to surface this.
   */
  | { ok: true; stream: MediaStream; degraded?: CaptureFailure }
  | { ok: false; failure: CaptureFailure };

/**
 * getUserMedia constraints.
 *
 * Echo cancellation, noise suppression and auto gain are on because without
 * them a laptop speaker feeds straight back into its own microphone and the
 * call is unusable — this is the one place where the browser's DSP is doing
 * something we could not reasonably do ourselves.
 */
function constraintsFor(request: CaptureRequest): MediaStreamConstraints {
  return {
    audio: request.audio
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: AUDIO_CHANNELS,
        }
      : false,
    video: request.video
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        }
      : false,
  };
}

/**
 * Map a getUserMedia rejection to something a person can act on.
 *
 * The DOMException names are the only reliable signal here — the messages differ
 * per browser — and collapsing them all to "could not access camera" throws away
 * the difference between "you denied this" and "there is no camera", which need
 * opposite responses from the user.
 */
export function classifyCaptureError(error: unknown): CaptureFailure {
  const name: string = error instanceof DOMException ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        kind: 'permission-denied',
        message:
          'Access to your microphone or camera was blocked. Allow it in your browser’s address bar, then try again.',
        // Retryable: the user can grant permission and press the button again
        // without reloading.
        retryable: true,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        kind: 'no-device',
        message: 'No microphone or camera was found on this device.',
        retryable: false,
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        kind: 'device-in-use',
        message:
          'Your microphone or camera is already in use by another application. Close it and try again.',
        retryable: true,
      };
    default:
      return {
        kind: 'unknown',
        message: 'Could not start your microphone or camera.',
        retryable: true,
      };
  }
}

export async function captureLocalMedia(request: CaptureRequest): Promise<CaptureResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    // getUserMedia is absent outside a secure context, which is the usual cause
    // in practice — someone opening the app over plain http.
    return {
      ok: false,
      failure: {
        kind: 'insecure-context',
        message:
          'Calls need a secure connection. Open this workspace over HTTPS (or localhost) to use audio and video.',
        retryable: false,
      },
    };
  }

  if (!request.audio && !request.video) {
    return {
      ok: false,
      failure: {
        kind: 'unsupported',
        message: 'A call needs at least a microphone or a camera.',
        retryable: false,
      },
    };
  }

  try {
    const stream: MediaStream = await navigator.mediaDevices.getUserMedia(constraintsFor(request));
    return { ok: true, stream };
  } catch (error) {
    const failure: CaptureFailure = classifyCaptureError(error);

    // A camera failure must not cost the user the whole call. Falling back to
    // audio is almost always what they want, and it is the difference between
    // "your camera is blocked" and "the call did not happen".
    if (request.video && request.audio && failure.kind !== 'insecure-context') {
      try {
        const audioOnly: MediaStream = await navigator.mediaDevices.getUserMedia(
          constraintsFor({ audio: true, video: false }),
        );
        return { ok: true, stream: audioOnly, degraded: failure };
      } catch {
        // Both failed; report the original, which is the more specific one.
      }
    }

    return { ok: false, failure };
  }
}

/** Stop every track, which is what actually turns the camera light off. */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export interface DeviceInventory {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export async function enumerateDevices(): Promise<DeviceInventory> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { microphones: [], cameras: [], speakers: [] };
  }

  const devices: MediaDeviceInfo[] = await navigator.mediaDevices.enumerateDevices();
  return {
    microphones: devices.filter((d) => d.kind === 'audioinput'),
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    speakers: devices.filter((d) => d.kind === 'audiooutput'),
  };
}

/**
 * Whether a call can start at all, checked BEFORE ringing anyone.
 *
 * Ringing a peer and then discovering there is no microphone wastes their time
 * and looks like a fault on their end.
 */
export function canStartCall(devices: DeviceInventory, wantVideo: boolean): CaptureFailure | null {
  if (devices.microphones.length === 0) {
    return {
      kind: 'no-device',
      message: 'No microphone was found, so there is nothing to call with.',
      retryable: false,
    };
  }
  if (wantVideo && devices.cameras.length === 0) {
    return {
      kind: 'no-device',
      message: 'No camera was found. You can still start an audio call.',
      retryable: false,
    };
  }
  return null;
}
