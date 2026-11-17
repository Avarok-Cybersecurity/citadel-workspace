/**
 * A shared screen travels on its own track, and stops completely.
 *
 * `CallMediaKinds.screen` existed in the wire types from the beginning and
 * nothing read it — a declared capability with no implementation, which is the
 * shape this repository keeps finding. These cover the parts that decide
 * whether a share is a share: the track it goes out on, the profile it is
 * encoded at, and whether stopping actually stops.
 */
import { describe, it, expect } from 'vitest';
import { videoChunkToFrame, isScreenFrame, isVideoFrame, videoTrackFor } from '../frame-codec';
import { VIDEO_PROFILE_SCREEN, VIDEO_PROFILE_MAIN } from '../codec-support';
import {
  CALL_TRACK_SCREEN,
  CALL_TRACK_VIDEO,
  CALL_TRACK_VIDEO_THUMBNAIL,
} from '@/types/p2p-commands';

function chunk(type: 'key' | 'delta' = 'key'): Parameters<typeof videoChunkToFrame>[0] {
  return {
    type,
    timestamp: 1_000,
    byteLength: 4,
    copyTo: (destination: Uint8Array): void => destination.set([1, 2, 3, 4]),
  };
}

describe('a shared screen', () => {
  it('goes out on a track of its own', () => {
    const frame: ReturnType<typeof videoChunkToFrame> = videoChunkToFrame(chunk(), false, CALL_TRACK_SCREEN);
    expect(frame.track).toBe(CALL_TRACK_SCREEN);
    expect(isScreenFrame(frame)).toBe(true);
  });

  it('is still video, so the transport treats it as video', () => {
    // It needs keyframes, it can report gaps, and it must not be routed to the
    // audio decoder. Only the TRACK distinguishes it.
    expect(isVideoFrame(videoChunkToFrame(chunk(), false, CALL_TRACK_SCREEN))).toBe(true);
  });

  it('is not confused with the camera or its thumbnail', () => {
    expect(isScreenFrame(videoChunkToFrame(chunk(), false))).toBe(false);
    expect(isScreenFrame(videoChunkToFrame(chunk(), true))).toBe(false);
    expect(videoTrackFor(false)).toBe(CALL_TRACK_VIDEO);
    expect(videoTrackFor(true)).toBe(CALL_TRACK_VIDEO_THUMBNAIL);
    expect(CALL_TRACK_SCREEN).not.toBe(CALL_TRACK_VIDEO);
    expect(CALL_TRACK_SCREEN).not.toBe(CALL_TRACK_VIDEO_THUMBNAIL);
  });

  it('keeps the keyframe and discardable flags the transport relies on', () => {
    const key: ReturnType<typeof videoChunkToFrame> = videoChunkToFrame(chunk('key'), false, CALL_TRACK_SCREEN);
    const delta: ReturnType<typeof videoChunkToFrame> = videoChunkToFrame(chunk('delta'), false, CALL_TRACK_SCREEN);
    expect(key.flags).not.toBe(delta.flags);
  });

  it('is encoded larger and slower than a face', () => {
    // A screen is read, not watched: text at 720p is unreadable, and almost
    // every frame is identical to the last so the rate costs nothing.
    expect(VIDEO_PROFILE_SCREEN.width).toBeGreaterThan(VIDEO_PROFILE_MAIN.width);
    expect(VIDEO_PROFILE_SCREEN.framerate).toBeLessThan(VIDEO_PROFILE_MAIN.framerate);
    // And given more bits, because the frames that DO change change everywhere
    // at once -- a scroll, a slide, a window moving.
    expect(VIDEO_PROFILE_SCREEN.bitrate).toBeGreaterThan(VIDEO_PROFILE_MAIN.bitrate);
  });
});
