/**
 * One side's frames of an internal-HTTP message, sent under the other side's credit: the head,
 * the body in chunks of at most `IHTTP_MAX_CHUNK_BYTES`, each spending one credit, then End. A
 * port of the Rust SDK's `ihttp/outbox.rs` for apps on the glue ABI, which have no Rust SDK
 * underneath them; the host's router enforces the same credit either way.
 */
import { IHTTP_INITIAL_CREDIT, IHTTP_MAX_CHUNK_BYTES } from '../sdk/generated/AbiConstants';
import type { FrameKind } from '../sdk/generated/FrameKind';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';

/** `IhttpFrame::new`'s `v` (citadel-app-sdk-types `calls/ihttp.rs`). */
export const FRAME_VERSION: number = 1;

export const frame = (stream: bigint, kind: FrameKind): IhttpFrame => ({ v: FRAME_VERSION, stream, kind });

export class Outbox {
  private credit: number = IHTTP_INITIAL_CREDIT;
  private readonly queued: FrameKind[] = [];

  constructor(head: FrameKind, body: Uint8Array) {
    this.queued.push(head);
    for (let at: number = 0; at < body.length; at += IHTTP_MAX_CHUNK_BYTES) this.queued.push({ Body: { bytes: body.subarray(at, at + IHTTP_MAX_CHUNK_BYTES) } });
    this.queued.push('End');
  }

  grant(n: number): void {
    this.credit += n;
  }

  /** Every frame sent, End included. */
  get done(): boolean {
    return this.queued.length === 0;
  }

  /** The next frame the credit allows, or null until more is granted or when all are sent. */
  next(): FrameKind | null {
    const head: FrameKind | undefined = this.queued[0];
    if (head === undefined) return null;
    if (typeof head === 'object' && 'Body' in head) {
      if (this.credit === 0) return null;
      this.credit -= 1;
    }
    this.queued.shift();
    return head;
  }
}

/** A message's body, whole, from its chunks. */
export function joined(chunks: readonly Uint8Array[]): Uint8Array {
  const out: Uint8Array = new Uint8Array(chunks.reduce((n: number, c: Uint8Array) => n + c.length, 0));
  let at: number = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
