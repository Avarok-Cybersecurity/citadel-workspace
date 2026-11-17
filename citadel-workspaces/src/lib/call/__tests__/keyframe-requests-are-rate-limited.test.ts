/**
 * An un-primed decoder asked for a keyframe once per arriving frame.
 *
 * Every frame that reaches a decoder before its first keyframe is undecodable,
 * and each one sent a `CallKeyframeRequest` — a RELIABLE signal, on the same
 * chain `CallEnd` travels. At thirty frames a second that is thirty signals a
 * second, per track, per peer, for as long as the far side takes to notice and
 * produce a keyframe: at least a round trip plus an encode. So the flood was
 * guaranteed every time a stream started or a decoder reset, which is exactly
 * when the call is most fragile.
 *
 * Same shape as the annotation flood (round 509), on the same transport.
 */
import { describe, it, expect, vi } from 'vitest';

class StubVideoDecoder {
  state: string = 'configured';
  constructor(private readonly init: { output: (f: unknown) => void; error: (e: unknown) => void }) {}
  configure(): void {}
  decode(): void {}
  close(): void { this.state = 'closed'; }
  /** Test seam: what WebCodecs does on a fatal error. */
  fail(): void { this.init.error(new Error('boom')); }
}

vi.stubGlobal('VideoDecoder', StubVideoDecoder);
vi.stubGlobal('EncodedVideoChunk', class { constructor(public init: unknown) {} });

const { createVideoDecoder }: typeof import('../media-decoders') = await import('../media-decoders');
const { CALL_KIND_VIDEO }: typeof import('@/types/call-signals') = await import('@/types/call-signals');

/**
 * A VIDEO delta frame — `canStartDecoding` is false only for a video frame
 * without the keyframe flag, so `kind` matters as much as `flags`. My first
 * fixture omitted `kind`, which made every frame "decodable", primed the decoder
 * on frame one and asked for nothing: three tests failing because the fixture
 * never reached the path under test.
 */
const delta: never = { kind: CALL_KIND_VIDEO, flags: 0, track: 1, data: new Uint8Array([1]), timestamp: 0 } as never;

describe('an un-primed decoder', () => {
  it('asks once for a second of delta frames, not thirty times', () => {
    let clock: number = 0;
    let asks: number = 0;
    const decoder: ReturnType<typeof createVideoDecoder> = createVideoDecoder('vp8', () => {}, () => {}, () => { asks += 1; }, () => clock);

    // One second at 30fps, none of them decodable.
    for (let t: number = 0; t < 1_000; t += 33) {
      clock = t;
      decoder.decode(delta);
    }

    expect(asks, 'every undecodable frame sent a reliable signal').toBeLessThanOrEqual(3);
    expect(asks, 'nothing asked at all, so a stalled stream never recovers').toBeGreaterThan(0);
  });

  it('asks again after the interval, because a request can be lost', () => {
    // The opposite failure: asking exactly once would strand a stream for ever
    // if that single request did not arrive.
    let clock: number = 0;
    let asks: number = 0;
    const decoder: ReturnType<typeof createVideoDecoder> = createVideoDecoder('vp8', () => {}, () => {}, () => { asks += 1; }, () => clock);

    decoder.decode(delta);
    const afterFirst: number = asks;

    clock = 10_000;
    decoder.decode(delta);

    expect(asks, 'a lost keyframe request was never followed by another').toBeGreaterThan(afterFirst);
  });

});
