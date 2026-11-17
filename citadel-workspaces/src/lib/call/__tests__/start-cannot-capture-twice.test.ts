/**
 * `CallSession.start()` must not capture two streams.
 *
 * `closed` was the only guard, and it does not cover a SECOND start arriving
 * while the first is still awaiting the permission prompt. Both entries then
 * assigned `localStream` and `pump`, so the first stream was overwritten with
 * nothing left holding a reference to it — never stopped, camera light on until
 * the page reloads. Reachable by double-clicking Call (the buttons are not
 * disabled until `invite-sent`, which happens after capture) or Accept.
 *
 * getUserMedia is stubbed to resolve on our signal, which is the only way to
 * have two starts genuinely in flight at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { CallSession } from '../call-session';
import type { CallMediaKinds } from '@/types/call-signals';

const g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>;
const savedMedia: ReturnType<typeof Object.getOwnPropertyDescriptor> = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const savedKeys: Record<string, unknown> = {};
const KEYS: string[] = ['AudioEncoder', 'AudioDecoder', 'VideoEncoder', 'VideoDecoder',
  'MediaStreamTrackProcessor', 'MediaStreamTrackGenerator'];

interface FakeTrack {
  kind: string;
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

function makeTrack(): FakeTrack {
  return { kind: 'audio', enabled: true, stop: vi.fn(), addEventListener: vi.fn() };
}

interface FakeStream {
  getTracks: () => FakeTrack[];
  getAudioTracks: () => FakeTrack[];
  getVideoTracks: () => never[];
  tracks: FakeTrack[];
}

/** A stream whose tracks record whether anything ever stopped them. */
function makeStream(): FakeStream {
  const tracks: FakeTrack[] = [makeTrack()];
  return {
    getTracks: (): FakeTrack[] => tracks,
    getAudioTracks: (): FakeTrack[] => tracks,
    getVideoTracks: (): never[] => [],
    tracks,
  };
}

let release: (() => void) | null = null;
let streams: FakeStream[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach((): void => {
  for (const k of KEYS) savedKeys[k] = g[k];
  g.AudioEncoder = Object.assign(function () {}, {
    isConfigSupported: (): Promise<{ supported: boolean }> => Promise.resolve({ supported: true }),
  });
  g.AudioDecoder = function (): void {};
  g.VideoEncoder = Object.assign(function () {}, {
    isConfigSupported: (): Promise<{ supported: boolean }> => Promise.resolve({ supported: false }),
  });
  g.VideoDecoder = function (): void {};
  // The pump reads frames off this; a reader that never yields keeps the pump
  // idle without it throwing, which is all these tests need from it.
  g.MediaStreamTrackProcessor = function (this: Record<string, unknown>): void {
    this.readable = { getReader: (): { read: () => Promise<unknown>; cancel: () => Promise<void>; } => ({ read: (): Promise<unknown> => new Promise((): void => {}), cancel: (): Promise<void> => Promise.resolve() }) };
  };
  g.MediaStreamTrackGenerator = function (this: Record<string, unknown>): void {
    this.writable = { getWriter: (): { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } => ({ write: vi.fn(), close: vi.fn() }) };
  };

  streams = [];
  getUserMedia = vi.fn(
    () =>
      new Promise((resolve) => {
        // Held open so a second start() can arrive mid-prompt, exactly as a
        // user double-clicking does.
        release = (): void => {
          const stream: ReturnType<typeof makeStream> = makeStream();
          streams.push(stream);
          resolve(stream as unknown as MediaStream);
        };
      }),
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: () => Promise.resolve([]) },
  });
});

afterEach(() => {
  for (const k of KEYS) g[k] = savedKeys[k];
  if (savedMedia) Object.defineProperty(navigator, 'mediaDevices', savedMedia);
  release = null;
});

function makeSession(): CallSession {
  return new CallSession({
    onFrame: vi.fn(),
    onStreamsChanged: vi.fn(),
    onSpeakingChanged: vi.fn(),
    onCaptureFailed: vi.fn(),
    onNeedKeyframe: vi.fn(), onTrackEnded: vi.fn(),
  });
}

describe('CallSession.start re-entrancy', () => {
  it('captures once when pressed twice during the permission prompt', async () => {
    const session: CallSession = makeSession();

    const first: Promise<CallMediaKinds | null> = session.start({ audio: true, video: false, screen: false });
    const second: Promise<CallMediaKinds | null> = session.start({ audio: true, video: false, screen: false });

    // Both are in flight; the prompt has not answered yet.
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    release?.();
    const [a, b] = await Promise.all([first, second]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(1);
    // Both callers get the same answer, so neither believes it started a call
    // the other did not.
    expect(a).toEqual(b);

    session.close();
    // The one stream captured is the one stopped. A second, orphaned stream
    // would have no owner to stop it — that is the camera light that stays on.
    expect(streams[0].tracks[0].stop).toHaveBeenCalled();
  });

  it('allows a genuine second attempt after the first finishes', async () => {
    const session: CallSession = makeSession();

    const first: Promise<CallMediaKinds | null> = session.start({ audio: true, video: false, screen: false });
    release?.();
    await first;

    const second: Promise<CallMediaKinds | null> = session.start({ audio: true, video: false, screen: false });
    release?.();
    await second;

    // Not a replay of the first answer: a user who retries after a failure, or
    // a session reused for a second call, must actually capture again.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    session.close();
  });
});
