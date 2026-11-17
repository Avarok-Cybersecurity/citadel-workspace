/**
 * Drives captured frames into the encoders.
 *
 * Without this nothing ever calls encode: capture produces a MediaStream, the
 * encoder consumes VideoFrame and AudioData objects, and something has to pull
 * one into the other every frame. A call missing this looks completely healthy —
 * both sides connect, tiles render, the timer ticks — and not one frame is sent.
 */

import { trackProcessor } from './track-transforms';
import { debugLog } from '@/lib/debug-config';
import type { TrackProcessorCtor } from '@/lib/call/track-transforms';

export interface CapturePumpCallbacks {
  onVideoFrame: (frame: VideoFrame, isKeyframe: boolean) => void;
  onAudioData: (data: AudioData) => void;
}

/**
 * Pull frames off a shared screen until stopped.
 *
 * Its own pump rather than a second stream through the main one: the screen
 * starts and stops many times during a call while the camera and microphone run
 * throughout, and a pump that owns both would have to tear down the wrong half.
 * Video only -- see captureScreen for why system audio is asked for and never
 * depended on.
 */
export class ScreenPump {
  private stopped: boolean = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly onFrame: (frame: VideoFrame) => void) {}

  start(stream: MediaStream): void {
    const Processor: ReturnType<typeof trackProcessor> = trackProcessor();
    const track: MediaStreamTrack | undefined = stream.getVideoTracks()[0];
    if (!track) return;

    if (!Processor) {
      // No MediaStreamTrackProcessor: the canvas fallback the camera uses reads
      // a <video> element, and a screen at 1920x1080 through a canvas copy per
      // frame costs more than it is worth. Sharing is refused up front by
      // `canShareScreen` instead of half-working here.
      debugLog('Call', 'no MediaStreamTrackProcessor; screen cannot be captured here');
      return;
    }

    const reader: ReadableStreamDefaultReader<VideoFrame | AudioData> =
      new Processor({ track }).readable.getReader();
    this.cleanups.push((): void => void reader.cancel().catch((): void => {}));
    void (async (): Promise<void> => {
      while (!this.stopped) {
        const { done, value } = await reader
          .read()
          .catch((): { done: boolean; value: undefined } => ({ done: true, value: undefined }));
        if (done || !value) break;
        if (this.stopped) {
          (value as VideoFrame).close();
          break;
        }
        this.onFrame(value as VideoFrame);
      }
    })();
  }

  stop(): void {
    this.stopped = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}



/**
 * Pull frames off a local stream until stopped.
 *
 * MediaStreamTrackProcessor is the efficient path — it hands over the decoded
 * frame the browser already has. Where it is missing (Firefox, Safari) the
 * fallback draws the video element to a canvas each animation frame, which
 * costs a copy per frame but keeps calling possible rather than silently
 * producing a black picture.
 */
export class CapturePump {
  private stopped: boolean = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly callbacks: CapturePumpCallbacks) {}

  start(stream: MediaStream): void {
    const Processor: TrackProcessorCtor | null = trackProcessor();

    const videoTrack: MediaStreamTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      if (Processor) {
        this.pumpTrack(new Processor({ track: videoTrack }).readable, (frame) =>
          this.callbacks.onVideoFrame(frame as VideoFrame, false),
        );
      } else {
        this.pumpVideoViaCanvas(stream);
      }
    }

    const audioTrack: MediaStreamTrack = stream.getAudioTracks()[0];
    if (audioTrack && Processor) {
      this.pumpTrack(new Processor({ track: audioTrack }).readable, (data) =>
        this.callbacks.onAudioData(data as AudioData),
      );
    } else if (audioTrack) {
      debugLog('Call', 'no MediaStreamTrackProcessor; audio cannot be captured here');
    }
  }

  private pumpTrack(
    readable: ReadableStream<VideoFrame | AudioData>,
    handle: (chunk: VideoFrame | AudioData) => void,
  ): void {
    const reader: ReturnType<typeof readable.getReader> = readable.getReader();
    this.cleanups.push(() => void reader.cancel().catch(() => undefined));

    const loop = async (): Promise<void> => {
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done || !value) return;
        if (this.stopped) {
          // Closed rather than handed on: frames are scarce GPU handles, and
          // one delivered after teardown would never be released.
          value.close();
          return;
        }
        handle(value);
      }
    };

    void loop().catch((error) => debugLog('Call', 'capture pump ended', error));
  }

  private pumpVideoViaCanvas(stream: MediaStream): void {
    const video: HTMLVideoElement = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    // play() returns a promise in browsers that implement the modern spec and
    // undefined in older ones, so the result is guarded rather than assumed.
    // Autoplay may also be refused outright, which is not fatal here — the
    // element only exists to source frames.
    void Promise.resolve(video.play()).catch(() => undefined);

    let raf: number = 0;
    const draw = (): void => {
      if (this.stopped) return;
      if (video.videoWidth > 0) {
        // VideoFrame from an element is the one construction path available
        // without the processor API.
        const frame: VideoFrame = new VideoFrame(video, { timestamp: performance.now() * 1000 });
        this.callbacks.onVideoFrame(frame, false);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    this.cleanups.push(() => {
      cancelAnimationFrame(raf);
      video.srcObject = null;
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }
}
