/**
 * The session owns every physical resource a call holds: the camera, the
 * encoders, one decoder set per peer. Getting teardown wrong leaves the camera
 * light on after a call ends, which is the single most alarming bug a calling
 * feature can ship.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { CallSession } from '../call-session';
import type { CallMediaKinds } from '@/types/call-signals';

const stopped: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
const codecInstances: Array<{ close: ReturnType<typeof vi.fn> }> = [];

function stubCodecClass(): new (...args: unknown[]) => unknown {
  return class {
    state: string = 'configured';
    encodeQueueSize: number = 0;
    encode: ReturnType<typeof vi.fn> = vi.fn();
    decode: ReturnType<typeof vi.fn> = vi.fn();
    configure: ReturnType<typeof vi.fn> = vi.fn();
    close: ReturnType<typeof vi.fn> = vi.fn((): void => { this.state = 'closed'; });
    constructor() { codecInstances.push(this as unknown as { close: ReturnType<typeof vi.fn> }); }
    static isConfigSupported: () => Promise<{ supported: boolean; }> = async (): Promise<{ supported: boolean; }> => ({ supported: true });
  };
}

interface FakeTrack {
  kind: 'audio' | 'video';
  readyState: string;
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: (event: string, fn: () => void) => void;
  /** Test-only: what the browser does when a device is unplugged. */
  fireEnded: () => void;
}

/** A track that records its 'ended' listener, so a test can fire it. */
function makeTrack(kind: 'audio' | 'video'): FakeTrack {
  const listeners: Array<() => void> = [];
  return {
    kind,
    readyState: 'live',
    enabled: true,
    stop: vi.fn(),
    addEventListener: (event: string, fn: () => void): void => {
      if (event === 'ended') listeners.push(fn);
    },
    /** Test-only: what the browser does when a device is unplugged. */
    fireEnded: (): void => listeners.forEach((fn): void => fn()),
  };
}

function fakeStream(withVideo: boolean): MediaStream {
  const tracks: FakeTrack[] = withVideo
    ? [makeTrack('video'), makeTrack('audio')]
    : [makeTrack('audio')];
  stopped.push(...tracks);
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream;
}

type Mock = ReturnType<typeof vi.fn>;

function callbacks(): {
  onFrame: Mock;
  onStreamsChanged: Mock;
  onCaptureFailed: Mock;
  onNeedKeyframe: Mock;
  onTrackEnded: Mock;
  onSpeakingChanged: Mock;
} {
  return { onFrame: vi.fn(), onStreamsChanged: vi.fn(),
    onSpeakingChanged: vi.fn(), onCaptureFailed: vi.fn(), onNeedKeyframe: vi.fn(), onTrackEnded: vi.fn() };
}

beforeEach(() => {
  stopped.length = 0;
  codecInstances.length = 0;
  vi.stubGlobal('VideoEncoder', stubCodecClass());
  vi.stubGlobal('AudioEncoder', stubCodecClass());
  vi.stubGlobal('VideoDecoder', stubCodecClass());
  vi.stubGlobal('AudioDecoder', stubCodecClass());
  vi.stubGlobal('EncodedVideoChunk', class { constructor(public init: unknown) {} });
  vi.stubGlobal('EncodedAudioChunk', class { constructor(public init: unknown) {} });
  vi.stubGlobal(
    'MediaStreamTrackGenerator',
    class {
      writable: { getWriter: () => { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } } = { getWriter: () => ({ write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }) };
      stop: ReturnType<typeof vi.fn> = vi.fn();
      constructor(public init: { kind: string }) {}
    },
  );
  vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[] = []) {} getTracks(): unknown[] { return this.tracks; } });
  // The efficient capture path. Without it the session falls back to the canvas
  // pump, which needs a real <video> element and an animation frame loop.
  vi.stubGlobal(
    'MediaStreamTrackProcessor',
    class {
      readable: { getReader: () => { read: () => Promise<unknown>; cancel: ReturnType<typeof vi.fn> } } = { getReader: () => ({ read: (): Promise<unknown> => new Promise((): void => {}), cancel: vi.fn().mockResolvedValue(undefined) }) };
      constructor(public init: { track: unknown }) {}
    },
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream(true)) },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('starting a call', () => {
  it('reports the media it actually got, not what was asked for', async () => {
    // A blocked camera falls back to audio, and the caller must tell peers the
    // truth about what it will send — otherwise their tiles wait forever for
    // video that is never coming.
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream(false)) },
      configurable: true,
    });
    const session: CallSession = new CallSession(callbacks());

    const got: CallMediaKinds | null = await session.start({ audio: true, video: true, screen: false });

    expect(got).toEqual({ audio: true, video: false, screen: false });
  });

  it('surfaces a capture failure with its reason instead of returning silently', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('no', 'NotFoundError')) },
      configurable: true,
    });
    const cbs: ReturnType<typeof callbacks> = callbacks();
    const session: CallSession = new CallSession(cbs);

    const got: CallMediaKinds | null = await session.start({ audio: true, video: false, screen: false });

    expect(got).toBeNull();
    expect(cbs.onCaptureFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'no-device' }));
  });
});

describe('teardown', () => {
  it('stops every local track, so the camera light goes out', async () => {
    const session: CallSession = new CallSession(callbacks());
    await session.start({ audio: true, video: true, screen: false });

    session.close();

    expect(stopped.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(session.getLocalStream()).toBeNull();
  });

  it('closes every codec it opened', async () => {
    const session: CallSession = new CallSession(callbacks());
    await session.start({ audio: true, video: true, screen: false });
    session.acceptFrame(2n, { track: 1, kind: 1, timestamp: 0, flags: 1, payload: new Uint8Array([1]) });

    session.close();

    expect(codecInstances.length).toBeGreaterThan(0);
    expect(codecInstances.every((c) => c.close.mock.calls.length === 1)).toBe(true);
  });

  it('is safe to close twice', async () => {
    const session: CallSession = new CallSession(callbacks());
    await session.start({ audio: true, video: true, screen: false });

    session.close();
    session.close();

    expect(stopped.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
  });

  it('ignores frames arriving after close', async () => {
    const cbs: ReturnType<typeof callbacks> = callbacks();
    const session: CallSession = new CallSession(cbs);
    await session.start({ audio: true, video: true, screen: false });
    session.close();
    cbs.onStreamsChanged.mockClear();

    session.acceptFrame(2n, { track: 1, kind: 1, timestamp: 0, flags: 1, payload: new Uint8Array([1]) });

    expect(cbs.onStreamsChanged).not.toHaveBeenCalled();
  });
});

describe('peers', () => {
  it('notifies once when a peer’s stream appears, not per frame', async () => {
    // A notify per frame would re-render the whole call surface sixty times a
    // second.
    const cbs: ReturnType<typeof callbacks> = callbacks();
    const session: CallSession = new CallSession(cbs);
    await session.start({ audio: true, video: true, screen: false });

    const frame: { track: number; kind: number; timestamp: number; flags: number; payload: Uint8Array<ArrayBuffer>; } = { track: 1, kind: 1, timestamp: 0, flags: 1, payload: new Uint8Array([1]) };
    session.acceptFrame(2n, frame);
    session.acceptFrame(2n, frame);
    session.acceptFrame(2n, frame);

    expect(cbs.onStreamsChanged).toHaveBeenCalledTimes(1);
  });

  it('releases a peer’s decoders when they leave', async () => {
    const session: CallSession = new CallSession(callbacks());
    await session.start({ audio: true, video: true, screen: false });
    session.acceptFrame(2n, { track: 1, kind: 1, timestamp: 0, flags: 1, payload: new Uint8Array([1]) });
    const opened: number = codecInstances.length;

    session.removePeer(2n);

    expect(codecInstances.some((c) => c.close.mock.calls.length === 1)).toBe(true);
    expect(opened).toBeGreaterThan(0);
  });

  it('asks the peer for a keyframe when its stream cannot start on a delta', async () => {
    // A decoder handed delta frames first emits garbage; the request must reach
    // the peer's encoder, not sit in a buffer nothing drains.
    const cbs: ReturnType<typeof callbacks> = callbacks();
    const session: CallSession = new CallSession(cbs);
    await session.start({ audio: true, video: true, screen: false });

    // flags: 2 is discardable-not-keyframe — undecodable as a first frame.
    session.acceptFrame(2n, { track: 1, kind: 1, timestamp: 0, flags: 2, payload: new Uint8Array([1]) });

    expect(cbs.onNeedKeyframe).toHaveBeenCalledWith(2n, 1);
  });

  it('rebuilds a peer’s decoder when they announce a different send codec', async () => {
    const cbs: ReturnType<typeof callbacks> = callbacks();
    const session: CallSession = new CallSession(cbs);
    await session.start({ audio: true, video: true, screen: false });
    session.acceptFrame(2n, { track: 1, kind: 1, timestamp: 0, flags: 1, payload: new Uint8Array([1]) });
    cbs.onStreamsChanged.mockClear();

    session.setPeerReceiveCodec(2n, 'avc1.42E01F');

    // The old decoder was configured for the wrong bitstream; keeping it would
    // decode garbage forever.
    expect(cbs.onStreamsChanged).toHaveBeenCalledTimes(1);
  });
});

describe('codec negotiation', () => {
  it('re-picks the send codec from what peers can actually decode', async () => {
    const session: CallSession = new CallSession(callbacks());
    await session.start({ audio: true, video: true, screen: false });
    // The stub supports every encoder, so the provisional pick is our best
    // (AV1); a peer that only decodes VP9 must pull us down to VP9.
    expect(session.getCodec()).toBe('av01.0.05M.08');

    const changed: boolean = session.renegotiateSendCodec([
      [{ codec: 'vp09.00.31.08', hardware: false, maxHeight: 720 }],
    ]);

    expect(changed).toBe(true);
    expect(session.getCodec()).toBe('vp09.00.31.08');
  });

  it('reports no change when peers already decode our choice', async () => {
    const session: CallSession = new CallSession(callbacks());
    await session.start({ audio: true, video: true, screen: false });

    const changed: boolean = session.renegotiateSendCodec([
      [{ codec: 'av01.0.05M.08', hardware: false, maxHeight: 720 }],
    ]);

    expect(changed).toBe(false);
  });
});

describe('closing during capture', () => {
  it('stops the camera when close() ran while getUserMedia was pending', async () => {
    // The permission prompt can outlive the call. Adopting the stream after
    // close() leaves the camera light on until the page reloads.
    let release: (stream: MediaStream) => void = () => {};
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockReturnValue(new Promise((resolve) => { release = resolve; })),
      },
      configurable: true,
    });
    const session: CallSession = new CallSession(callbacks());
    const lateStream: MediaStream = fakeStream(true);

    const pending: Promise<CallMediaKinds | null> = session.start({ audio: true, video: true, screen: false });
    session.close();
    release(lateStream);

    expect(await pending).toBeNull();
    for (const track of lateStream.getTracks() as unknown as Array<{ stop: ReturnType<typeof vi.fn> }>) {
      expect(track.stop).toHaveBeenCalled();
    }
    expect(session.getLocalStream()).toBeNull();
  });
});

/**
 * A SECOND start on a session whose first start already finished.
 *
 * `start()` memoises an in-flight attempt, so two captures racing each other
 * share one. That covers the double-click. It does not cover the SEQUENTIAL
 * case: the first capture resolves, `starting` is cleared, and a second start
 * then runs `adoptStream` and `startPump` again — replacing `this.localStream`
 * and `this.pump` with nothing left holding the originals. Never stopped:
 * camera light on until the page reloads, and an orphaned pump still reading
 * frames off a track nobody is sending.
 *
 * The reachable path is glare. Both sides ring at once; the loser's outbound
 * capture has already completed by the time they accept the inbound call, and
 * `accept()` starts the session again on the same object.
 */
describe('starting a second time on the same session', () => {
  it('stops the first capture rather than orphaning it', async () => {
    const session: CallSession = new CallSession(callbacks());

    await session.start({ audio: true, video: true, screen: false });
    const first: Array<{ stop: ReturnType<typeof vi.fn> }> = [...stopped];
    expect(first.length, 'the first capture produced no tracks to orphan').toBeGreaterThan(0);
    expect(first.every((t) => t.stop.mock.calls.length === 0)).toBe(true);

    // A fresh device answer, as the browser gives on a second getUserMedia.
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream(true)) },
      configurable: true,
    });
    await session.start({ audio: true, video: true, screen: false });

    for (const track of first) {
      expect(
        track.stop,
        'the first capture’s track was replaced without being stopped — camera on until reload',
      ).toHaveBeenCalled();
    }
  });

  it('leaves the second capture running', async () => {
    // The opposite failure: stopping indiscriminately would kill the stream the
    // session just adopted, and the assertion above would still pass.
    const session: CallSession = new CallSession(callbacks());
    await session.start({ audio: true, video: true, screen: false });

    const second: MediaStream = fakeStream(true);
    const secondTracks: FakeTrack[] = second.getTracks() as unknown as FakeTrack[];
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(second) },
      configurable: true,
    });
    await session.start({ audio: true, video: true, screen: false });

    for (const track of secondTracks) {
      expect(track.stop, 'the newly adopted capture was stopped').not.toHaveBeenCalled();
    }
  });
});
