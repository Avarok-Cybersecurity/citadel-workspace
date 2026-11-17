/**
 * Leaking a decoder per peer per reconnect exhausts the browser's codec slots
 * and starts failing calls that have nothing wrong with them — a failure that
 * appears long after the code that caused it, in a different call.
 *
 * WebCodecs and MediaStreamTrackGenerator have no jsdom implementation, so they
 * are stubbed; what is under test is our own lifecycle logic around them.
 */
import { describe, it, expect, vi, beforeEach, afterEach   } from 'vitest';
import { PeerReceiver } from '../peer-receiver';
import { CALL_FLAG_KEYFRAME, CALL_KIND_AUDIO, CALL_KIND_VIDEO } from '@/types/p2p-commands';
import type { WireFrame } from '../frame-codec';

const decoderInstances: Array<{ close: ReturnType<typeof vi.fn>; decode: ReturnType<typeof vi.fn> }> = [];

function stubCodec(): new (...args: unknown[]) => unknown {
  return class {
    state: string = 'configured';
    decode: ReturnType<typeof vi.fn> = vi.fn();
    close: ReturnType<typeof vi.fn> = vi.fn((): void => { this.state = 'closed'; });
    configure: ReturnType<typeof vi.fn> = vi.fn();
    constructor() {
      decoderInstances.push(this as unknown as { close: ReturnType<typeof vi.fn>; decode: ReturnType<typeof vi.fn> });
    }
    static isConfigSupported: () => Promise<{ supported: boolean; }> = async (): Promise<{ supported: boolean; }> => ({ supported: true });
  };
}

beforeEach(() => {
  decoderInstances.length = 0;
  vi.stubGlobal('VideoDecoder', stubCodec());
  vi.stubGlobal('AudioDecoder', stubCodec());
  vi.stubGlobal('EncodedVideoChunk', class { constructor(public init: unknown) {} });
  vi.stubGlobal('EncodedAudioChunk', class { constructor(public init: unknown) {} });
  vi.stubGlobal(
    'MediaStreamTrackGenerator',
    class {
      kind: string;
      writable: { getWriter: () => { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } } =
        { getWriter: (): { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } => ({ write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }) };
      stop: ReturnType<typeof vi.fn> = vi.fn();
      constructor(init: { kind: string }) { this.kind = init.kind; }
    },
  );
  vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[] = []) {} getTracks(): unknown[] { return this.tracks; } });
});

afterEach(() => { vi.unstubAllGlobals(); });

function frame(kind: number, flags: number = CALL_FLAG_KEYFRAME): WireFrame {
  return { track: kind === CALL_KIND_VIDEO ? 1 : 0, kind, timestamp: 0, flags, payload: new Uint8Array([1]) };
}

describe('PeerReceiver', () => {
  const options: { videoCodec: string; onNeedKeyframe: ReturnType<typeof vi.fn> } = { videoCodec: 'vp09.00.31.08', onNeedKeyframe: vi.fn() };

  it('creates no decoder until a frame actually arrives', () => {
    // A peer who never turns their camera on should not cost a decoder and a
    // track for the whole call.
    new PeerReceiver(options);

    expect(decoderInstances).toHaveLength(0);
  });

  it('has no video stream before any video arrives', () => {
    const receiver: PeerReceiver = new PeerReceiver(options);
    expect(receiver.getVideoStream()).toBeNull();
  });

  it('builds the video decoder once, not per frame', () => {
    const receiver: PeerReceiver = new PeerReceiver(options);
    receiver.accept(frame(CALL_KIND_VIDEO));
    receiver.accept(frame(CALL_KIND_VIDEO));
    receiver.accept(frame(CALL_KIND_VIDEO));

    expect(decoderInstances).toHaveLength(1);
    expect(receiver.getVideoStream()).not.toBeNull();
  });

  it('keeps audio and video on separate decoders', () => {
    const receiver: PeerReceiver = new PeerReceiver(options);
    receiver.accept(frame(CALL_KIND_VIDEO));
    receiver.accept(frame(CALL_KIND_AUDIO));

    expect(decoderInstances).toHaveLength(2);
  });

  it('closes every codec it opened', () => {
    const receiver: PeerReceiver = new PeerReceiver(options);
    receiver.accept(frame(CALL_KIND_VIDEO));
    receiver.accept(frame(CALL_KIND_AUDIO));

    receiver.close();

    expect(decoderInstances.every((d) => d.close.mock.calls.length === 1)).toBe(true);
  });

  it('is safe to close twice', () => {
    // Both a peer leaving and the call ending can close a receiver, and they
    // race in a group call.
    const receiver: PeerReceiver = new PeerReceiver(options);
    receiver.accept(frame(CALL_KIND_VIDEO));

    receiver.close();
    receiver.close();

    expect(decoderInstances[0].close).toHaveBeenCalledTimes(1);
  });

  it('ignores frames arriving after close', () => {
    // Frames in flight when a peer leaves would otherwise resurrect a decoder
    // that nothing will ever close.
    const receiver: PeerReceiver = new PeerReceiver(options);
    receiver.close();
    receiver.accept(frame(CALL_KIND_VIDEO));

    expect(decoderInstances).toHaveLength(0);
  });

  it('asks for a keyframe after a video gap', () => {
    const onNeedKeyframe: ReturnType<typeof vi.fn> = vi.fn();
    const receiver: PeerReceiver = new PeerReceiver({ ...options, onNeedKeyframe });

    receiver.handleGap(1, true);

    expect(onNeedKeyframe).toHaveBeenCalledWith(1);
  });

  it('does not ask for a keyframe after an audio gap', () => {
    // Opus frames decode independently; the missing ones are simply gone, and
    // requesting a keyframe would be asking for something meaningless.
    const onNeedKeyframe: ReturnType<typeof vi.fn> = vi.fn();
    const receiver: PeerReceiver = new PeerReceiver({ ...options, onNeedKeyframe });

    receiver.handleGap(0, false);

    expect(onNeedKeyframe).not.toHaveBeenCalled();
  });
});
