/**
 * Turning decoded frames back into a MediaStream the DOM can play.
 *
 * WebCodecs hands back VideoFrame and AudioData objects, which no element
 * renders directly. Two routes exist and neither is universal, so this picks
 * per browser and says so — a call that silently shows nothing because the
 * preferred API was missing is the worst outcome here.
 */

import { trackGenerator } from './track-transforms';
import { debugLog } from '@/lib/debug-config';
import type { TrackGeneratorCtor } from '@/lib/call/track-transforms';


export interface RemoteVideoSink {
  stream: MediaStream;
  /** Frames are CLOSED by the sink; callers must not reuse them afterwards. */
  write: (frame: VideoFrame) => void;
  close: () => void;
}

/**
 * A video sink backed by MediaStreamTrackGenerator where available.
 *
 * The canvas fallback exists because Firefox and Safari have no generator. It
 * costs a draw per frame, which is measurably worse, but "measurably worse" and
 * "does not work" are not the same thing.
 */
export function createRemoteVideoSink(): RemoteVideoSink {
  const Generator: TrackGeneratorCtor | null = trackGenerator();

  if (Generator) {
    const track: MediaStreamTrack & { writable: WritableStream<VideoFrame | AudioData>; } = new Generator({ kind: 'video' });
    const writer: ReturnType<typeof track.writable.getWriter> = track.writable.getWriter();
    const stream: MediaStream = new MediaStream([track]);

    return {
      stream,
      write(frame: VideoFrame): void {
        // Frames are scarce GPU handles; the writer takes ownership and closes
        // them. Failing to close leaks until the decoder stalls.
        void writer.write(frame).catch(() => frame.close());
      },
      close(): void {
        void writer.close().catch(() => undefined);
        track.stop();
      },
    };
  }

  debugLog('Call', 'MediaStreamTrackGenerator unavailable; using the canvas path');

  const canvas: HTMLCanvasElement = document.createElement('canvas');
  // Sized on the first frame; a zero-sized canvas produces a black stream.
  canvas.width = 640;
  canvas.height = 360;
  const context: ReturnType<typeof canvas.getContext> = canvas.getContext('2d');

  // Degrade rather than throw. If neither route to a MediaStream exists, the
  // call should continue without this peer's video — throwing here would take
  // down the whole call over one participant's picture.
  if (typeof canvas.captureStream !== 'function') {
    debugLog('Call', 'no MediaStream route available; video will not render');
    return {
      stream: new MediaStream(),
      write: (frame) => frame.close(),
      close: (): void => {},
    };
  }

  const stream: MediaStream = canvas.captureStream();

  return {
    stream,
    write(frame: VideoFrame): void {
      try {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        context?.drawImage(frame, 0, 0);
      } finally {
        // Closed in a finally so a draw failure cannot leak the handle.
        frame.close();
      }
    },
    close(): void {
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

export interface RemoteAudioSink {
  stream: MediaStream | null;
  write: (data: AudioData) => void;
  close: () => void;
}

/**
 * An audio sink, or null capability if this browser cannot build one.
 *
 * Returning a null stream rather than throwing lets a call carry video and
 * report the missing audio, instead of failing wholesale.
 */
export function createRemoteAudioSink(): RemoteAudioSink {
  const Generator: TrackGeneratorCtor | null = trackGenerator();

  if (!Generator) {
    return {
      stream: null,
      write(data: AudioData): void {
        data.close();
      },
      close(): void {},
    };
  }

  const track: MediaStreamTrack & { writable: WritableStream<VideoFrame | AudioData>; } = new Generator({ kind: 'audio' });
  const writer: ReturnType<typeof track.writable.getWriter> = track.writable.getWriter();
  const stream: MediaStream = new MediaStream([track]);

  return {
    stream,
    write(data: AudioData): void {
      void writer.write(data).catch(() => data.close());
    },
    close(): void {
      void writer.close().catch(() => undefined);
      track.stop();
    },
  };
}
