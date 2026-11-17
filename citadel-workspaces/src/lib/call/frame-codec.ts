/**
 * Conversion between WebCodecs chunks and the transport's frame shape.
 *
 * Kept separate from the encoder and decoder because this is where the
 * off-by-one mistakes live — timestamp units, keyframe flags, track numbering —
 * and none of them throw. A dropped keyframe flag produces a picture that
 * decodes into garbage; a timestamp in the wrong unit produces audio that plays
 * at the wrong speed. Both are silent, and both are testable here.
 */

import {
  CALL_FLAG_DISCARDABLE,
  CALL_FLAG_KEYFRAME,
  CALL_KIND_AUDIO,
  CALL_KIND_VIDEO,
  CALL_TRACK_AUDIO,
  CALL_TRACK_VIDEO,
  CALL_TRACK_VIDEO_THUMBNAIL,
  CALL_TRACK_SCREEN,
} from '@/types/p2p-commands';

/** A frame as the Rust transport expects it. */
export interface WireFrame {
  track: number;
  kind: number;
  /** Microseconds since capture start. u32 on the wire — see wrapTimestamp. */
  timestamp: number;
  flags: number;
  payload: Uint8Array;
}

/**
 * WebCodecs timestamps are microseconds in a JS number; the wire carries u32.
 *
 * A u32 of microseconds wraps every ~71.6 minutes, which is a perfectly
 * ordinary call length, so wrapping is expected rather than exceptional. The
 * receiver's jitter buffer compares sequence numbers with wrapping arithmetic
 * for the same reason. Truncating instead of wrapping would make a long call
 * fall apart exactly once, an hour and twelve minutes in — the kind of bug
 * nobody reproduces.
 */
export function wrapTimestamp(microseconds: number): number {
  const wrapped: number = Math.floor(microseconds) % 0x1_0000_0000;
  return wrapped < 0 ? wrapped + 0x1_0000_0000 : wrapped;
}

export function videoTrackFor(thumbnail: boolean): number {
  return thumbnail ? CALL_TRACK_VIDEO_THUMBNAIL : CALL_TRACK_VIDEO;
}

/** Whether a frame carries a shared screen rather than a camera. */
export function isScreenFrame(frame: WireFrame): boolean {
  return frame.kind === CALL_KIND_VIDEO && frame.track === CALL_TRACK_SCREEN;
}

/**
 * Turn an encoded video chunk into a wire frame.
 *
 * `discardable` marks delta frames the receiver may skip under load. Keyframes
 * are never discardable: dropping one corrupts everything that follows until the
 * next arrives.
 */
export function videoChunkToFrame(
  chunk: { type: 'key' | 'delta'; timestamp: number; byteLength: number; copyTo: (dst: Uint8Array) => void },
  thumbnail: boolean,
  /** Overrides the camera track numbering; a shared screen has its own. */
  track?: number,
): WireFrame {
  const payload: Uint8Array<ArrayBuffer> = new Uint8Array(chunk.byteLength);
  chunk.copyTo(payload);

  const isKey: boolean = chunk.type === 'key';
  return {
    track: track ?? videoTrackFor(thumbnail),
    kind: CALL_KIND_VIDEO,
    timestamp: wrapTimestamp(chunk.timestamp),
    flags: isKey ? CALL_FLAG_KEYFRAME : CALL_FLAG_DISCARDABLE,
    payload,
  };
}

/**
 * Turn an encoded audio chunk into a wire frame.
 *
 * Every audio frame is marked a keyframe and never discardable. Opus frames are
 * independently decodable, and audio is the one stream a call cannot lose —
 * marking it discardable would let congestion control drop the thing the call
 * exists for.
 */
export function audioChunkToFrame(chunk: {
  timestamp: number;
  byteLength: number;
  copyTo: (dst: Uint8Array) => void;
}): WireFrame {
  const payload: Uint8Array<ArrayBuffer> = new Uint8Array(chunk.byteLength);
  chunk.copyTo(payload);

  return {
    track: CALL_TRACK_AUDIO,
    kind: CALL_KIND_AUDIO,
    timestamp: wrapTimestamp(chunk.timestamp),
    flags: CALL_FLAG_KEYFRAME,
    payload,
  };
}

export interface DecoderChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  data: Uint8Array;
}

/** Turn a received frame back into what a WebCodecs decoder expects. */
export function frameToDecoderChunk(frame: WireFrame): DecoderChunkInit {
  return {
    type: (frame.flags & CALL_FLAG_KEYFRAME) !== 0 ? 'key' : 'delta',
    timestamp: frame.timestamp,
    data: frame.payload,
  };
}

export function isVideoFrame(frame: WireFrame): boolean {
  return frame.kind === CALL_KIND_VIDEO;
}

export function isKeyframe(frame: WireFrame): boolean {
  return (frame.flags & CALL_FLAG_KEYFRAME) !== 0;
}

/**
 * Whether a decoder can start on this frame.
 *
 * A video decoder handed a delta frame first emits garbage — visible as a
 * smeared, blocky picture that slowly corrects. Waiting for a keyframe shows
 * nothing for a moment instead, which reads as "connecting" rather than "broken".
 */
export function canStartDecoding(frame: WireFrame): boolean {
  return !isVideoFrame(frame) || isKeyframe(frame);
}
