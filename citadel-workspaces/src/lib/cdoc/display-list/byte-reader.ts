/**
 * Bounds-checked reads over a DataView, in the encodings of `docs/display-list.md` v5
 * § Conventions: little-endian fixed integers, `uv` (LEB128, ≤ 5 bytes, fits 32 bits), `zz`
 * (zigzag over `uv`) and `str` (`uv` length + UTF-8). Nothing is copied: the reader walks the
 * caller's buffer.
 */

export class DisplayListError extends Error {
  constructor(message: string) {
    super(`display list: ${message}`);
    this.name = 'DisplayListError';
  }
}

const UTF8: TextDecoder = new TextDecoder('utf-8', { fatal: true });

/** `zz` decode: `(u >>> 1) ^ -(u & 1)`, on a value already read as an unsigned 32-bit `uv`. */
export function unzigzag(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

export interface Utf8String {
  readonly text: string;
  readonly bytes: Uint8Array;
}

export class ByteReader {
  private readonly view: DataView;
  private readonly end: number;
  pos: number;

  /** Reads `view` from absolute byte `start` up to (not including) absolute byte `end`. */
  constructor(view: DataView, start: number, end: number) {
    if (start < 0 || end > view.byteLength || start > end) {
      throw new DisplayListError(`range ${start}..${end} is outside the ${view.byteLength}-byte buffer`);
    }
    this.view = view;
    this.pos = start;
    this.end = end;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  private need(n: number): void {
    if (this.pos + n > this.end) throw new DisplayListError(`truncated at byte ${this.end}`);
  }

  u8(): number {
    this.need(1);
    const v: number = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v: number = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v: number = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v: number = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v: number = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** `rgba`: four bytes r, g, b, a, packed as 0xRRGGBBAA (a big-endian read of the same bytes). */
  rgba(): number {
    this.need(4);
    const v: number = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  /** Unsigned LEB128 of at most five bytes; a 5th byte above 0x0F, or a 6th, is malformed. */
  uv(): number {
    if (this.pos < this.end) {
      const first: number = this.view.getUint8(this.pos);
      if (first < 0x80) {
        this.pos += 1;
        return first;
      }
    }
    let value: number = 0;
    for (let shift: number = 0; shift <= 28; shift += 7) {
      const byte: number = this.u8();
      if (shift === 28 && byte > 0x0f) throw new DisplayListError('varint overflows 32 bits');
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
    }
    throw new DisplayListError('varint longer than five bytes');
  }

  /**
   * A `uv` element count, checked against the bytes left before anything is sized by it: each
   * element takes at least `minBytes`, so a count the remaining bytes cannot hold is refused
   * rather than allocated (CWE-789).
   */
  count(minBytes: number, what: string): number {
    const n: number = this.uv();
    const left: number = this.end - this.pos;
    if (n * minBytes > left) throw new DisplayListError(`${what} claims ${n} entries, but only ${left} bytes remain`);
    return n;
  }

  zz(): number {
    return unzigzag(this.uv() >>> 0);
  }

  str(): string {
    return this.utf8().text;
  }

  /** The next `len` bytes as a reader of their own; this one moves past them. */
  take(len: number): ByteReader {
    this.need(len);
    const sub: ByteReader = new ByteReader(this.view, this.pos, this.pos + len);
    this.pos += len;
    return sub;
  }

  /** The next `len` bytes, in place. */
  bytes(len: number): Uint8Array {
    this.need(len);
    const at: number = this.pos;
    this.pos += len;
    return new Uint8Array(this.view.buffer, this.view.byteOffset + at, len);
  }

  /** A `str` with its UTF-8 bytes, for a reader that indexes it by byte offset. */
  utf8(): Utf8String {
    const len: number = this.uv();
    this.need(len);
    const at: number = this.pos;
    const bytes: Uint8Array = new Uint8Array(this.view.buffer, this.view.byteOffset + at, len);
    this.pos += len;
    try {
      return { text: UTF8.decode(bytes), bytes };
    } catch {
      throw new DisplayListError(`string at byte ${at} is not UTF-8`);
    }
  }
}
