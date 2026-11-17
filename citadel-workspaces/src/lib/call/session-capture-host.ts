/**
 * Building the `CaptureHost` a session hands to `startLocalCapture`.
 *
 * Separate from `CallSession` because the delicate part is not the wiring but
 * the RELEASE: a session that starts a second time must let go of the first
 * capture before adopting the second, and both places that has to happen are
 * here, next to each other, rather than buried among a dozen other session
 * methods.
 */
import { stopStream } from './media-capture';
import { CapturePump } from './capture-pump';
import type { CaptureHost } from './session-start';
import type { CaptureFailure } from './media-capture';
import type { VideoCodec } from './codec-support';

/** What the host needs from the session, stated rather than reached for. */
export interface CaptureHostPorts {
  isClosed: () => boolean;
  onCaptureFailed: (failure: CaptureFailure) => void;
  getStream: () => MediaStream | null;
  setStream: (stream: MediaStream | null) => void;
  onTrackEnded: (track: MediaStreamTrack) => void;
  configureSender: (encoders: Array<{ codec: VideoCodec; hardware: boolean }>) => void;
  hasCodec: () => boolean;
  getPump: () => CapturePump | null;
  setPump: (pump: CapturePump | null) => void;
  onVideoFrame: (frame: VideoFrame, isKeyframe: boolean) => void;
  onAudioData: (data: AudioData) => void;
}

export function makeCaptureHost(ports: CaptureHostPorts): CaptureHost {
  return {
    isClosed: ports.isClosed,
    onCaptureFailed: ports.onCaptureFailed,

    adoptStream: (stream: MediaStream): void => {
      // Release what this session was already holding, before replacing it.
      //
      // `start()`'s in-flight guard covers two captures racing; it does not
      // cover a SECOND start after the first has resolved, which is what glare
      // produces — the loser's outbound capture is already complete when they
      // accept the inbound call, and `accept()` starts the same session again.
      // Both assignments here used to overwrite with nothing left holding the
      // originals: camera light on until the page reloads, and a pump still
      // reading frames off a track nobody sends.
      stopStream(ports.getStream());
      ports.setStream(stream);
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => ports.onTrackEnded(track));
      }
    },

    dropStream: (): void => ports.setStream(null),

    configureSender: (encoders): void =>
      ports.configureSender(encoders as Array<{ codec: VideoCodec; hardware: boolean }>),

    hasCodec: ports.hasCodec,

    startPump: (stream: MediaStream): void => {
      // Same reasoning as adoptStream: the previous pump is still reading.
      ports.getPump()?.stop();
      const pump: CapturePump = new CapturePump({
        onVideoFrame: ports.onVideoFrame,
        onAudioData: ports.onAudioData,
      });
      ports.setPump(pump);
      pump.start(stream);
    },
  };
}
