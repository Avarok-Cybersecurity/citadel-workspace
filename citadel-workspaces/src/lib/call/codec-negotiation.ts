/**
 * Codec negotiation: choosing what to send given what the far side can decode.
 *
 * Split from codec-support so each stays under the file cap. This half is pure
 * and fully unit tested; the other half touches WebCodecs and cannot be.
 */
import { type VideoCodec } from './codec-support';

/**
 * Pick the video codec to send with: our best encoder that the peer can decode.
 *
 * Returns null when there is no overlap, which is a real outcome and must be
 * reported rather than papered over — an audio call still works.
 */
export function negotiateVideoCodec(
  ourEncoders: Array<{ codec: VideoCodec; hardware: boolean }>,
  peerDecoders: Array<{ codec: string; hardware: boolean; maxHeight: number }>,
): VideoCodec | null {
  const peerCodecs: Set<string> = new Set(peerDecoders.map((d) => d.codec));
  for (const { codec } of ourEncoders) {
    if (peerCodecs.has(codec)) return codec;
  }
  return null;
}

/**
 * The codec every participant in a group call can decode.
 *
 * A mesh sender encodes ONCE and fans the same bitstream out to everyone, so
 * one codec has to satisfy the whole room. Picking per-peer would mean an
 * encoder instance per participant, which is what makes mesh calls melt laptops.
 */
export function negotiateGroupVideoCodec(
  ourEncoders: Array<{ codec: VideoCodec; hardware: boolean }>,
  peerDecoderLists: Array<Array<{ codec: string; hardware: boolean; maxHeight: number }>>,
): VideoCodec | null {
  for (const { codec } of ourEncoders) {
    if (peerDecoderLists.every((list) => list.some((d) => d.codec === codec))) {
      return codec;
    }
  }
  return null;
}
