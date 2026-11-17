import { classifyCaptureError, type CaptureFailure } from './media-capture';

/**
 * Ask for a screen, a window or a tab.
 *
 * `getDisplayMedia` differs from `getUserMedia` in ways that matter here:
 *
 *  - the browser draws its own picker, so a refusal is a person deciding not
 *    to share rather than a permission that can be granted once and reused;
 *  - the returned track ends on its own when the user presses the browser's
 *    "Stop sharing" bar, which is a control this app does not own and cannot
 *    hide -- so the caller MUST watch for that and put the button back;
 *  - audio is requested but rarely granted, and never on some platforms, so it
 *    is asked for and not depended on.
 *
 * `NotAllowedError` here is the picker being dismissed. That is not a failure
 * worth alarming anybody about, and it is reported as `cancelled` so the caller
 * can stay quiet rather than raise an error toast at somebody who simply
 * changed their mind.
 */
export type ScreenCaptureResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; failure: CaptureFailure };

export async function captureScreen(): Promise<ScreenCaptureResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return {
      ok: false,
      failure: {
        kind: 'unsupported',
        message: 'This browser cannot share a screen. Chrome, Edge and Safari 13+ can.',
        retryable: false,
      },
    };
  }

  try {
    const stream: MediaStream = await navigator.mediaDevices.getDisplayMedia({
      // `displaySurface: 'monitor'` is a HINT, not a filter: the user still
      // chooses. Asking for the monitor makes "entire screen" the default tab
      // in the picker, which is what somebody sharing to explain something
      // usually wants.
      video: { displaySurface: 'monitor', frameRate: { ideal: 8, max: 15 } },
      // Asked for, not depended on. Chrome offers tab audio, Firefox does not,
      // and Safari never grants it; a call that only worked with system audio
      // would be a call that only worked in one browser.
      audio: false,
    });
    return { ok: true, stream };
  } catch (error) {
    const failure: CaptureFailure = classifyCaptureError(error);
    // The picker dismissed, not a device refused. Same DOMException name, and a
    // completely different thing to say to somebody about it.
    if (failure.kind === 'permission-denied') return { ok: false, cancelled: true };
    return { ok: false, failure };
  }
}
