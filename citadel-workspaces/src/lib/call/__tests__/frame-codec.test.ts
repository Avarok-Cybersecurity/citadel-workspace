/**
 * None of these mistakes throw. A dropped keyframe flag decodes into garbage, a
 * timestamp in the wrong unit plays audio at the wrong speed, and a u32 that
 * truncates instead of wrapping breaks a call exactly once — an hour and twelve
 * minutes in, which nobody reproduces.
 */
import { describe, it, expect } from 'vitest';
import type { DecoderChunkInit } from '@/lib/call/frame-codec';
import {
  wrapTimestamp,
  videoChunkToFrame,
  audioChunkToFrame,
  frameToDecoderChunk,
  canStartDecoding,
  videoTrackFor,
  isKeyframe,
  type WireFrame,
} from '../frame-codec';
import {
  CALL_FLAG_DISCARDABLE,
  CALL_FLAG_KEYFRAME,
  CALL_KIND_AUDIO,
  CALL_KIND_VIDEO,
  CALL_TRACK_AUDIO,
  CALL_TRACK_VIDEO,
  CALL_TRACK_VIDEO_THUMBNAIL,
} from '@/types/p2p-commands';

function chunk(type: 'key' | 'delta', timestamp: number, bytes: number[]): { type: "key" | "delta"; timestamp: number; byteLength: number; copyTo: (dst: Uint8Array) => void; } {
  return {
    type,
    timestamp,
    byteLength: bytes.length,
    copyTo: (dst: Uint8Array): void => dst.set(bytes),
  };
}

describe('wrapTimestamp', () => {
  it('passes ordinary timestamps through', () => {
    expect(wrapTimestamp(1_000_000)).toBe(1_000_000);
  });

  it('wraps rather than truncating at the u32 boundary', () => {
    // ~71.6 minutes of microseconds. A perfectly ordinary call length, so this
    // path is expected rather than exceptional.
    expect(wrapTimestamp(0x1_0000_0000)).toBe(0);
    expect(wrapTimestamp(0x1_0000_0005)).toBe(5);
  });

  it('keeps the result inside u32 for very long calls', () => {
    const eightHours: number = 8 * 60 * 60 * 1_000_000;
    const wrapped: number = wrapTimestamp(eightHours);

    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(0x1_0000_0000);
  });

  it('floors fractional microseconds instead of emitting a non-integer', () => {
    expect(wrapTimestamp(1234.9)).toBe(1234);
  });
});

describe('video frames', () => {
  it('marks a keyframe and never marks it discardable', () => {
    // Both matter: the receiver needs the flag to start decoding, and congestion
    // control must never drop this frame.
    const frame: WireFrame = videoChunkToFrame(chunk('key', 500, [1, 2, 3]), false);

    expect(frame.flags & CALL_FLAG_KEYFRAME).toBeTruthy();
    expect(frame.flags & CALL_FLAG_DISCARDABLE).toBeFalsy();
  });

  it('marks a delta frame discardable', () => {
    const frame: WireFrame = videoChunkToFrame(chunk('delta', 600, [4, 5]), false);

    expect(frame.flags & CALL_FLAG_KEYFRAME).toBeFalsy();
    expect(frame.flags & CALL_FLAG_DISCARDABLE).toBeTruthy();
  });

  it('routes main and thumbnail video to different tracks', () => {
    // They are separate streams to the receiver; sharing a track would
    // interleave two resolutions into one decoder.
    expect(videoChunkToFrame(chunk('key', 0, [1]), false).track).toBe(CALL_TRACK_VIDEO);
    expect(videoChunkToFrame(chunk('key', 0, [1]), true).track).toBe(CALL_TRACK_VIDEO_THUMBNAIL);
    expect(videoTrackFor(true)).not.toBe(videoTrackFor(false));
  });

  it('copies the payload rather than aliasing the chunk', () => {
    const frame: WireFrame = videoChunkToFrame(chunk('key', 0, [9, 8, 7]), false);

    expect(Array.from(frame.payload)).toEqual([9, 8, 7]);
  });

  it('carries the video kind', () => {
    expect(videoChunkToFrame(chunk('key', 0, [1]), false).kind).toBe(CALL_KIND_VIDEO);
  });
});

describe('audio frames', () => {
  it('is always a keyframe and never discardable', () => {
    // Opus frames decode independently, and audio is the stream the call exists
    // for — marking it discardable would let congestion control drop it.
    const frame: WireFrame = audioChunkToFrame(chunk('delta', 100, [1, 2]));

    expect(frame.flags & CALL_FLAG_KEYFRAME).toBeTruthy();
    expect(frame.flags & CALL_FLAG_DISCARDABLE).toBeFalsy();
    expect(frame.track).toBe(CALL_TRACK_AUDIO);
    expect(frame.kind).toBe(CALL_KIND_AUDIO);
  });

  it('wraps its timestamp like video does', () => {
    expect(audioChunkToFrame(chunk('key', 0x1_0000_000A, [1])).timestamp).toBe(10);
  });
});

describe('decoding', () => {
  function frame(flags: number, kind: number): WireFrame {
    return { track: 1, kind, timestamp: 42, flags, payload: new Uint8Array([1, 2]) };
  }

  it('round-trips a keyframe back to a key chunk', () => {
    const init: DecoderChunkInit = frameToDecoderChunk(frame(CALL_FLAG_KEYFRAME, CALL_KIND_VIDEO));

    expect(init.type).toBe('key');
    expect(init.timestamp).toBe(42);
  });

  it('round-trips a delta frame back to a delta chunk', () => {
    expect(frameToDecoderChunk(frame(CALL_FLAG_DISCARDABLE, CALL_KIND_VIDEO)).type).toBe('delta');
  });

  it('refuses to start video decoding on a delta frame', () => {
    // Starting mid-stream paints a smeared, blocky picture that slowly
    // corrects. Waiting shows nothing for a moment, which reads as connecting
    // rather than broken.
    expect(canStartDecoding(frame(CALL_FLAG_DISCARDABLE, CALL_KIND_VIDEO))).toBe(false);
    expect(canStartDecoding(frame(CALL_FLAG_KEYFRAME, CALL_KIND_VIDEO))).toBe(true);
  });

  it('starts audio decoding on any frame', () => {
    // Audio has no such dependency, and waiting would silence the call.
    expect(canStartDecoding(frame(0, CALL_KIND_AUDIO))).toBe(true);
  });

  it('agrees with isKeyframe', () => {
    expect(isKeyframe(frame(CALL_FLAG_KEYFRAME, CALL_KIND_VIDEO))).toBe(true);
    expect(isKeyframe(frame(CALL_FLAG_DISCARDABLE, CALL_KIND_VIDEO))).toBe(false);
  });
});
