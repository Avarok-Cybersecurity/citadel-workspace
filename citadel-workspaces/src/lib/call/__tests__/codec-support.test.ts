/**
 * Codec negotiation decides whether a call can carry video at all, and in a
 * group it decides whether one encoder can serve the whole room. Getting it
 * wrong does not throw — it silently drops to audio, or quietly spawns an
 * encoder per participant and melts the machine.
 */
import { describe, it, expect } from 'vitest';
import {
  VIDEO_CODEC_PREFERENCE,
  VIDEO_PROFILE_MAIN,
  VIDEO_PROFILE_THUMBNAIL,
  type VideoCodec,
} from '../codec-support';
import { negotiateVideoCodec, negotiateGroupVideoCodec } from '../codec-negotiation';

const AV1: "av01.0.05M.08" = 'av01.0.05M.08';
const VP9: "vp09.00.31.08" = 'vp09.00.31.08';
const H264: "avc1.42E01F" = 'avc1.42E01F';

function decoders(...codecs: string[]): { codec: string; hardware: boolean; maxHeight: number; }[] {
  return codecs.map((codec) => ({ codec, hardware: false, maxHeight: 720 }));
}

function encoders(...codecs: VideoCodec[]): { codec: "av01.0.05M.08" | "vp09.00.31.08" | "avc1.42E01F"; hardware: boolean; }[] {
  return codecs.map((codec) => ({ codec, hardware: false }));
}

describe('negotiateVideoCodec', () => {
  it('picks our most preferred codec the peer can decode', () => {
    expect(negotiateVideoCodec(encoders(AV1, VP9, H264), decoders(AV1, VP9, H264))).toBe(AV1);
  });

  it('falls to the best shared codec when the peer cannot decode our first choice', () => {
    // The common real case: we have an AV1 encoder, the peer is an older device
    // that decodes only VP9 and H.264.
    expect(negotiateVideoCodec(encoders(AV1, VP9, H264), decoders(VP9, H264))).toBe(VP9);
  });

  it('lands on H.264 when that is all the peer has', () => {
    expect(negotiateVideoCodec(encoders(AV1, VP9, H264), decoders(H264))).toBe(H264);
  });

  it('honours OUR order, not the peer’s', () => {
    // The peer listing H.264 first is not a preference we should adopt: they
    // decode all three, and we are the one paying to encode.
    expect(negotiateVideoCodec(encoders(AV1, VP9), decoders(H264, VP9, AV1))).toBe(AV1);
  });

  it('returns null when nothing overlaps, rather than guessing', () => {
    // A guess here would send a bitstream the peer cannot decode, which looks
    // exactly like a broken camera. Null lets the caller fall back to audio and
    // say so.
    expect(negotiateVideoCodec(encoders(AV1), decoders(H264))).toBeNull();
  });

  it('returns null when we have no encoder at all', () => {
    expect(negotiateVideoCodec([], decoders(AV1, VP9, H264))).toBeNull();
  });
});

describe('negotiateGroupVideoCodec', () => {
  it('picks a codec EVERY participant can decode', () => {
    // Alice decodes everything, Bob only VP9/H.264 — so VP9, even though we
    // could encode AV1 for Alice.
    const chosen: "av01.0.05M.08" | "vp09.00.31.08" | "avc1.42E01F" | null = negotiateGroupVideoCodec(encoders(AV1, VP9, H264), [
      decoders(AV1, VP9, H264),
      decoders(VP9, H264),
    ]);

    expect(chosen).toBe(VP9);
  });

  it('drops to the room’s weakest decoder', () => {
    const chosen: "av01.0.05M.08" | "vp09.00.31.08" | "avc1.42E01F" | null = negotiateGroupVideoCodec(encoders(AV1, VP9, H264), [
      decoders(AV1, VP9, H264),
      decoders(VP9, H264),
      decoders(H264),
    ]);

    expect(chosen).toBe(H264);
  });

  it('returns null when one participant shares nothing with us', () => {
    expect(
      negotiateGroupVideoCodec(encoders(AV1, VP9), [decoders(AV1, VP9), decoders(H264)]),
    ).toBeNull();
  });

  it('treats an empty room as our own best codec', () => {
    // A call whose other members have not answered yet still needs a codec to
    // configure the encoder with.
    expect(negotiateGroupVideoCodec(encoders(AV1, VP9), [])).toBe(AV1);
  });
});

describe('encoding profiles', () => {
  it('sends thumbnails at a small fraction of the main tier', () => {
    // The mesh only survives because non-speakers are sent the cheap tier. If
    // these ever converge, an eight-person call saturates a home uplink.
    expect(VIDEO_PROFILE_THUMBNAIL.bitrate * 4).toBeLessThan(VIDEO_PROFILE_MAIN.bitrate);
    expect(VIDEO_PROFILE_THUMBNAIL.height).toBeLessThan(VIDEO_PROFILE_MAIN.height);
  });

  it('prefers royalty-free codecs over H.264', () => {
    const av1: number = VIDEO_CODEC_PREFERENCE.indexOf(AV1);
    const vp9: number = VIDEO_CODEC_PREFERENCE.indexOf(VP9);
    const h264: number = VIDEO_CODEC_PREFERENCE.indexOf(H264);

    expect(av1).toBeLessThan(vp9);
    expect(vp9).toBeLessThan(h264);
  });
});
