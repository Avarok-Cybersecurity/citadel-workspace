/**
 * Reads the editor's small records (docs/edit-commands.md v4): the "CDA" awareness record, the
 * "CDP" peer view, the "CDI" added image, the "CDG" collection and a bare position; the "CDE"
 * result is decode-result.ts. Positions are kept as the exact bytes they were written as
 * (EditorPosition), so they go back into requests unchanged. Every record is read to its end;
 * a short, long or mis-tagged record throws.
 */
import type { AddedImage, EditorPosition, PageRect, PeerView } from '../controller';
import { RecordError } from './record-writer';

const utf8: TextDecoder = new TextDecoder('utf-8', { fatal: true });

export interface Awareness {
  readonly client: bigint;
  readonly anchor: EditorPosition;
  readonly head: EditorPosition;
}

export class RecordReader {
  private at: number = 0;

  constructor(private readonly bytes: Uint8Array) {}

  u8(): number {
    return this.byte();
  }

  private byte(): number {
    if (this.at >= this.bytes.length) throw new RecordError('truncated');
    return this.bytes[this.at++];
  }

  /** The three-letter tag, then the version byte, which must be `version`: any other is refused by name. */
  magic(tag: string, version: number): void {
    for (const ch of tag) {
      if (this.byte() !== ch.charCodeAt(0)) throw new RecordError(`not a ${tag} record`);
    }
    const v: number = this.byte();
    if (v !== version) throw new RecordError(`${tag} version ${v}; this UI reads version ${version}`);
  }

  uvBig(): bigint {
    let v: bigint = 0n;
    for (let shift: bigint = 0n; shift < 64n; shift += 7n) {
      const b: number = this.byte();
      if (shift === 63n && b > 1) throw new RecordError('varint overflows 64 bits');
      v |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return v;
    }
    throw new RecordError('varint overflows 64 bits');
  }

  /** A count, page number or length: a u64 that must also be a safe JS number. */
  uv(): number {
    const v: bigint = this.uvBig();
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RecordError(`${v} is too large for a count`);
    return Number(v);
  }

  zz(): number {
    const u: bigint = this.uvBig();
    const v: bigint = (u & 1n) === 0n ? u >> 1n : -(u >> 1n) - 1n;
    if (v < -0x8000_0000n || v > 0x7fff_ffffn) throw new RecordError(`coordinate ${v} does not fit an i32`);
    return Number(v);
  }

  str(): string {
    return utf8.decode(this.bytesField());
  }

  bytesField(): Uint8Array {
    const n: number = this.uv();
    if (this.at + n > this.bytes.length) throw new RecordError('truncated');
    const out: Uint8Array = this.bytes.slice(this.at, this.at + n);
    this.at += n;
    return out;
  }

  position(): EditorPosition {
    const from: number = this.at;
    this.uvBig();
    this.uvBig();
    return this.bytes.slice(from, this.at) as EditorPosition;
  }

  pageRect(): PageRect {
    const page: number = this.uv();
    return { page, rect: { x: this.zz(), y: this.zz(), width: this.zz(), height: this.zz() } };
  }

  caret(): PageRect | null {
    const tag: number = this.byte();
    if (tag === 0) return null;
    if (tag === 1) return this.pageRect();
    throw new RecordError(`caret tag ${tag}`);
  }

  /**
   * A count of elements of at least `minBytes` each, refused when the bytes left cannot hold
   * them, before anything is sized by it (CWE-789).
   */
  count(minBytes: number, what: string): number {
    const n: number = this.uv();
    const left: number = this.bytes.length - this.at;
    if (n * minBytes > left) throw new RecordError(`${what} claims ${n} entries, but only ${left} bytes remain`);
    return n;
  }

  /** Rects of a page each: page:uv and four pt, five bytes at least. */
  rects(): PageRect[] {
    return Array.from({ length: this.count(5, 'a rect list') }, (): PageRect => this.pageRect());
  }

  end(): void {
    if (this.at !== this.bytes.length) throw new RecordError(`${this.bytes.length - this.at} trailing byte(s)`);
  }
}

export function decodeAwareness(bytes: Uint8Array): Awareness {
  const r: RecordReader = new RecordReader(bytes);
  r.magic('CDA', 1);
  const client: bigint = r.uvBig();
  const anchor: EditorPosition = r.position();
  const head: EditorPosition = r.position();
  r.end();
  return { client, anchor, head };
}

export function decodePeerView(bytes: Uint8Array): PeerView {
  const r: RecordReader = new RecordReader(bytes);
  r.magic('CDP', 1);
  const client: bigint = r.uvBig();
  const caret: PageRect | null = r.caret();
  const selectionRects: PageRect[] = r.rects();
  r.end();
  return { client, caret, selectionRects };
}

export function decodePosition(bytes: Uint8Array): EditorPosition {
  const r: RecordReader = new RecordReader(bytes);
  const position: EditorPosition = r.position();
  r.end();
  return position;
}

const IMAGE_KINDS: readonly AddedImage['kind'][] = ['png', 'jpeg'];

export function decodeAddedImage(bytes: Uint8Array): AddedImage {
  const r: RecordReader = new RecordReader(bytes);
  r.magic('CDI', 1);
  const contentId: string = r.str();
  const kind: AddedImage['kind'] | undefined = IMAGE_KINDS[r.u8()];
  if (kind === undefined) throw new RecordError('unknown image kind');
  const width: number = r.uv();
  const height: number = r.uv();
  r.end();
  return { contentId, kind, width, height };
}

/** What a collection removed, and the waiting operations it dropped (a later diff re-sends them). */
export interface Collected {
  readonly units: number;
  readonly deletes: number;
  readonly pending: number;
}

export function decodeCollected(bytes: Uint8Array): Collected {
  const r: RecordReader = new RecordReader(bytes);
  r.magic('CDG', 2);
  const units: number = r.uv();
  const deletes: number = r.uv();
  const pending: number = r.uv();
  r.end();
  return { units, deletes, pending };
}
