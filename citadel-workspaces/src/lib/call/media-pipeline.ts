/**
 * WebCodecs encode and decode, wired to the transport.
 *
 * The conversion rules live in frame-codec.ts; this file owns the codec objects
 * and their lifecycle, which is the part that cannot be unit tested because
 * WebCodecs has no jsdom implementation. Keeping the two apart is what makes
 * the fiddly half testable.
 */

import {
  AUDIO_BITRATE,
  AUDIO_CHANNELS,
  AUDIO_CODEC,
  AUDIO_SAMPLE_RATE,
  VIDEO_PROFILE_MAIN,
  VIDEO_PROFILE_THUMBNAIL,
  VIDEO_PROFILE_SCREEN,
  type VideoCodec,
  type VideoProfile,
} from './codec-support';
import { levelFor, type CongestionState } from './congestion';
import {
  audioChunkToFrame,
  videoChunkToFrame,
  type WireFrame,
} from './frame-codec';
import { debugLog } from '@/lib/debug-config';
import type { QualityLevel } from '@/lib/call/congestion';

export type FrameSink = (frame: WireFrame) => void;

/**
 * How often to force a keyframe.
 *
 * Every four seconds bounds how long a joining or recovering participant stares
 * at nothing. Shorter wastes bandwidth on a stable link; longer makes joining a
 * call feel broken.
 */
const KEYFRAME_INTERVAL_MICROS: number = 4_000_000;

export interface VideoEncoderHandle {
  encode: (frame: VideoFrame, congestion: CongestionState) => void;
  requestKeyframe: () => void;
  close: () => void;
  queueSize: () => number;
}

/**
 * Encode video and hand each chunk to `sink`.
 *
 * `latencyMode: 'realtime'` is the load-bearing option: without it the encoder
 * buffers frames to improve compression, which is the right trade for a file
 * and precisely the wrong one for a conversation.
 *
 * `hardware` must be the answer the capability probe gave for THIS codec.
 * Hardcoding 'prefer-hardware' here killed every call on machines without a
 * hardware encoder (headless included): configure() errored, the codec closed,
 * and the capture pump died on the next encode — zero frames ever sent.
 */
export function createVideoEncoder(
  codec: VideoCodec,
  thumbnail: boolean,
  hardware: boolean,
  sink: FrameSink,
  onError: (error: Error) => void,
  /**
   * A shared screen instead of a camera: its own track number and its own
   * profile. Passing `screen` also implies `thumbnail: false` -- there is no
   * low-resolution variant of a screen, because an unreadable screen is not a
   * smaller version of the same thing, it is nothing.
   */
  screen?: { track: number },
  /**
   * The person's chosen ceiling, overriding the default for this stream.
   *
   * Passed in rather than read here: this module encodes, and which profile a
   * user asked for is a decision that belongs with the decision-maker. Absent
   * means the built-in profile, which is what every existing caller gets.
   */
  profileOverride?: VideoProfile,
): VideoEncoderHandle {
  const profile: VideoProfile =
    profileOverride ??
    (screen
      ? VIDEO_PROFILE_SCREEN
      : thumbnail
        ? VIDEO_PROFILE_THUMBNAIL
        : VIDEO_PROFILE_MAIN);
  const hardwareAcceleration: HardwareAcceleration = hardware ? 'prefer-hardware' : 'no-preference';
  let lastKeyframeAt: number = -Infinity;
  let forceKeyframe: boolean = true;

  const encoder: VideoEncoder = new VideoEncoder({
    output: (chunk): void => {
      if (chunk.type === 'key') lastKeyframeAt = chunk.timestamp;
      sink(videoChunkToFrame(chunk, thumbnail, screen?.track));
    },
    error: (error): void => onError(error instanceof Error ? error : new Error(String(error))),
  });

  encoder.configure({
    codec,
    width: profile.width,
    height: profile.height,
    bitrate: profile.bitrate,
    framerate: profile.framerate,
    latencyMode: 'realtime',
    hardwareAcceleration,
  });

  // 0, not -1: the encoder was just configured at `profile`, and rung 0 IS "the
  // profile as chosen". Starting at -1 made the first frame of every call
  // reconfigure before any congestion had been observed, replacing the chosen
  // profile with the ladder's absolute rung-0 values.
  let appliedRung: number = 0;

  return {
    encode(frame: VideoFrame, congestion: CongestionState): void {
      // As the decoder guard below: a fatal error closes the codec async, and
      // encode() on a closed codec throws out of the capture pump's read loop,
      // which then exits for good. The owner rebuilds it; stay quiet here.
      if (encoder.state === 'closed') return;
      // Reconfigure only when the rung actually changes. Reconfiguring per frame
      // resets the encoder's rate control and produces visible pulsing.
      if (congestion.rung !== appliedRung) {
        const level: QualityLevel = levelFor(congestion);
        // The ladder's rungs are absolute; the profile is the ceiling. Rung 0 is
        // 720p at 30fps, so without these caps a "saver" call (640x360 @15) was
        // encoded at 640x720 @30 -- a distorted picture at twice the frame rate
        // the user asked for, and the screen saver's deliberate 3fps became 30.
        // The ladder may only ever REDUCE what was chosen.
        const height: number = Math.min(profile.height, level.height);
        // Width follows height, or every degrade also stretches the picture:
        // `profile.width` with the rung's height is a different aspect ratio.
        // Even, because encoders reject odd dimensions.
        const width: number =
          Math.round((profile.width * height) / profile.height / 2) * 2;
        try {
          encoder.configure({
            codec,
            width,
            height,
            bitrate: Math.round(profile.bitrate * level.bitrateScale),
            framerate: Math.min(profile.framerate, level.framerate),
            latencyMode: 'realtime',
            hardwareAcceleration,
          });
          appliedRung = congestion.rung;
          // A reconfigure invalidates the reference chain, so the next frame has
          // to be a keyframe or the receiver decodes garbage.
          forceKeyframe = true;
        } catch (error) {
          debugLog('Call', 'encoder reconfigure failed', error);
        }
      }

      const dueForKeyframe: boolean = frame.timestamp - lastKeyframeAt >= KEYFRAME_INTERVAL_MICROS;
      encoder.encode(frame, { keyFrame: forceKeyframe || dueForKeyframe });
      forceKeyframe = false;
    },
    requestKeyframe(): void {
      // Set a flag rather than encoding now: the peer asks for this after a gap,
      // and the next captured frame is the earliest one we could send anyway.
      forceKeyframe = true;
    },
    close(): void {
      if (encoder.state !== 'closed') encoder.close();
    },
    queueSize: () => encoder.encodeQueueSize,
  };
}

export interface AudioEncoderHandle {
  encode: (data: AudioData) => void;
  close: () => void;
}

export function createAudioEncoder(sink: FrameSink, onError: (error: Error) => void): AudioEncoderHandle {
  const encoder: AudioEncoder = new AudioEncoder({
    output: (chunk): void => sink(audioChunkToFrame(chunk)),
    error: (error): void => onError(error instanceof Error ? error : new Error(String(error))),
  });

  encoder.configure({
    codec: AUDIO_CODEC,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
    bitrate: AUDIO_BITRATE,
  });

  return {
    encode(data: AudioData): void {
      // As the decoder guard below: a fatal error closes the codec async, and
      // encode() on a closed codec throws out of the capture pump's read loop,
      // which then exits for good. The owner rebuilds it; stay quiet here.
      if (encoder.state === 'closed') return;
      encoder.encode(data);
    },
    close(): void {
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}

