/**
 * A microphone or camera unplugged mid-call used to be invisible.
 *
 * The track ended, the capture pump's reader loop returned silently, and every
 * part of the UI went on insisting the call was healthy: the mic button still
 * read unmuted, peers still saw an unmuted tile, and heartbeats kept flowing on
 * their own timer so the liveness watchdog never noticed. A silently dead call
 * that looked fine, with no recovery but Leave and re-dial and nothing saying
 * so.
 *
 * The `closed` guard is the part most likely to be broken by a well-meaning
 * refactor: per spec `track.stop()` does not fire `ended`, so ordinary teardown
 * should be silent — but fakes do fire it, and without the guard every normal
 * hangup would tell the user their microphone had been disconnected.
 */

import { describe, it, expect, vi, beforeEach  } from 'vitest';
import { CallSession } from '../call-session';

interface FakeTrack {
  kind: string;
  readyState: string;
  enabled: boolean;
  stop: () => void;
  addEventListener: (event: string, fn: () => void) => void;
  fireEnded: () => void;
}

function makeTrack(kind: 'audio' | 'video'): FakeTrack {
  const listeners: Array<() => void> = [];
  return {
    kind,
    readyState: 'live',
    enabled: true,
    stop: vi.fn(),
    addEventListener: (event, fn): void => {
      if (event === 'ended') listeners.push(fn);
    },
    fireEnded: () => listeners.forEach((fn) => fn()),
  };
}

let tracks: FakeTrack[] = [];

function callbacks(): { onFrame: ReturnType<typeof vi.fn>; onStreamsChanged: ReturnType<typeof vi.fn>; onSpeakingChanged: ReturnType<typeof vi.fn>; onCaptureFailed: ReturnType<typeof vi.fn>; onNeedKeyframe: ReturnType<typeof vi.fn>; onTrackEnded: ReturnType<typeof vi.fn>; } {
  return {
    onFrame: vi.fn(),
    onStreamsChanged: vi.fn(),
    onSpeakingChanged: vi.fn(),
    onCaptureFailed: vi.fn(),
    onNeedKeyframe: vi.fn(),
    onTrackEnded: vi.fn(),
  };
}

async function startedSession(cbs: ReturnType<typeof callbacks>): Promise<CallSession> {
  tracks = [makeTrack('audio')];
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => tracks,
        getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
        getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
      }),
    },
    configurable: true,
  });
  const session: CallSession = new CallSession(cbs);
  await session.start({ audio: true, video: false, screen: false });
  return session;
}

describe('a capture device stopping mid-call', () => {
  beforeEach(() => { tracks = []; });

  it('is reported, with the kind that died', async () => {
    const cbs: ReturnType<typeof callbacks> = callbacks();
    await startedSession(cbs);

    tracks[0].fireEnded();

    expect(cbs.onTrackEnded).toHaveBeenCalledWith('audio');
  });

  it('is NOT reported during ordinary teardown', async () => {
    // Without the closed-guard this fires on every hangup, and the user is told
    // their microphone was disconnected every time they end a call.
    const cbs: ReturnType<typeof callbacks> = callbacks();
    const session: CallSession = await startedSession(cbs);

    session.close();
    tracks[0].fireEnded();

    expect(cbs.onTrackEnded).not.toHaveBeenCalled();
  });

  it('reports each device separately when a hub takes both', async () => {
    const cbs: ReturnType<typeof callbacks> = callbacks();
    tracks = [makeTrack('audio'), makeTrack('video')];
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => tracks,
          getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
          getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
        }),
      },
      configurable: true,
    });
    const session: CallSession = new CallSession(cbs);
    await session.start({ audio: true, video: true, screen: false });

    tracks[0].fireEnded();
    tracks[1].fireEnded();

    expect(cbs.onTrackEnded).toHaveBeenCalledWith('audio');
    expect(cbs.onTrackEnded).toHaveBeenCalledWith('video');
    void session;
  });
});
