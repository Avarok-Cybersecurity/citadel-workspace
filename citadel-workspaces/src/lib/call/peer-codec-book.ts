/**
 * What each peer in a call has told us about codecs.
 *
 * Two facts per peer, from signalling: what they can DECODE (so our sender can
 * pick something they can play) and what they will SEND (so our decoder for
 * them is configured for what actually arrives). Collected here rather than in
 * the manager because the manager's job is ordering, not remembering — and
 * before this existed the capabilities were received and thrown away, which
 * worked only when both machines happened to share a best encoder.
 */

import type { CallCodecCapabilities } from '@/types/p2p-commands';

export class PeerCodecBook {
  private readonly decodeCaps: Map<bigint, CallCodecCapabilities> = new Map<bigint, CallCodecCapabilities>();
  private readonly sendCodecs: Map<bigint, string> = new Map<bigint, string>();

  recordCaps(cid: bigint, caps: CallCodecCapabilities): void {
    this.decodeCaps.set(cid, caps);
  }

  /** Absent or null means the peer predates codec announcement; keep silent. */
  recordSendCodec(cid: bigint, codec: string | null | undefined): void {
    if (typeof codec === 'string' && codec.length > 0) {
      this.sendCodecs.set(cid, codec);
    }
  }

  /** Every peer's video decode list, for group send-codec negotiation. */
  decodeCapsLists(): Array<CallCodecCapabilities['video']> {
    return [...this.decodeCaps.values()].map((caps) => caps.video);
  }

  /** What each peer announced it sends, keyed by cid. */
  announcedSendCodecs(): ReadonlyMap<bigint, string> {
    return this.sendCodecs;
  }

  remove(cid: bigint): void {
    this.decodeCaps.delete(cid);
    this.sendCodecs.delete(cid);
  }

  clear(): void {
    this.decodeCaps.clear();
    this.sendCodecs.clear();
  }
}
