import { captureLocalMedia, stopStream, type CaptureFailure } from './media-capture';
import { supportedVideoEncoders, type VideoCodec } from './codec-support';

/** What `supportedVideoEncoders` reports, named so this module can pass it on. */
type VideoEncoderReport = { codec: VideoCodec; hardware: boolean };
import type { CallMediaKinds } from '@/types/p2p-commands';

/**
 * What starting a session needs from the session.
 *
 * Passed in rather than reached for, so this can be read -- and tested -- as
 * "capture, then configure, then pump" without a CallSession in the room.
 */
export interface CaptureHost {
  isClosed: () => boolean;
  onCaptureFailed: (failure: CaptureFailure) => void;
  adoptStream: (stream: MediaStream) => void;
  dropStream: () => void;
  configureSender: (encoders: VideoEncoderReport[]) => void;
  hasCodec: () => boolean;
  startPump: (stream: MediaStream) => void;
}

/**
 * Capture this tab's microphone and camera and start the encoders.
 *
 * Split out of `CallSession`, which was over its length ceiling. The sequence
 * here is the delicate part of starting a call, and every step of it is about
 * something that can happen WHILE it runs: the permission prompt can outlive
 * the call, the user can be refused their camera and still want the call, and
 * the pump must not start before there is a codec to feed.
 */
export async function startLocalCapture(
  requested: CallMediaKinds,
  host: CaptureHost,
): Promise<CallMediaKinds | null> {
    const result: Awaited<ReturnType<typeof captureLocalMedia>> =
    await captureLocalMedia({ audio: requested.audio, video: requested.video });
    // The permission prompt can outlive the call: if close() ran while the user
    // stared at it, adopting the stream now would leave the camera light on
    // with nothing attached to it until the page reloads.
    if (host.isClosed()) {
      if (result.ok) stopStream(result.stream);
      return null;
    }
    if (!result.ok) {
      host.onCaptureFailed(result.failure);
      return null;
    }

    // Video was requested and we fell back to audio. `ok` is true and the call
    // proceeds, but the user asked for their camera and did not get it — tell
    // them, through the same channel a hard failure uses.
    if (result.degraded) host.onCaptureFailed(result.degraded);

    host.adoptStream(result.stream);
    const hasVideo: boolean = result.stream.getVideoTracks().length > 0;
    const hasAudio: boolean = result.stream.getAudioTracks().length > 0;

    if (hasVideo) {
      const encoders: VideoEncoderReport[] = await supportedVideoEncoders();
      if (host.isClosed()) {
        stopStream(result.stream);
        host.dropStream();
        return null;
      }
      // No peer capabilities yet at this point, so this is our own best codec;
      // renegotiateSendCodec revisits once peers have answered with theirs.
      host.configureSender(encoders);
    }

    // Started only after the codec is known, since encodeVideo drops frames
    // until there is one — pumping before then would discard the opening
    // second of the call.
    host.startPump(result.stream);

    return { audio: hasAudio, video: hasVideo && host.hasCodec(), screen: false };
}
