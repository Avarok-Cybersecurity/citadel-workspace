/**
 * A bounds-checked cursor over wasm bytes. Every read past its end, every over-long LEB128 and
 * every invalid UTF-8 name throws `Malformed`, which the inspector reports as `malformed`.
 */

export class Malformed extends Error {
  constructor(message: string) {
    super(`wasm: ${message}`);
    this.name = 'Malformed';
  }
}

export class Reader {
  private at: number;

  constructor(private readonly bytes: Uint8Array, start: number, private readonly end: number) {
    if (end > bytes.byteLength) throw new Malformed('section past the end');
    this.at = start;
  }

  get done(): boolean {
    return this.at >= this.end;
  }

  get offset(): number {
    return this.at;
  }

  skip(n: number): void {
    if (n < 0 || this.at + n > this.end) throw new Malformed('read past the end');
    this.at += n;
  }

  byte(): number {
    if (this.at >= this.end) throw new Malformed('unexpected end');
    return this.bytes[this.at++];
  }

  u32(): number {
    return this.uleb(32);
  }

  /** A u64 LEB128 as a number: exact up to 2^53, which bounds every memory limit the host compares. */
  u64(): number {
    return this.uleb(64);
  }

  private uleb(bits: number): number {
    let result: number = 0;
    let scale: number = 1;
    const maxBytes: number = Math.ceil(bits / 7);
    for (let i: number = 0; i < maxBytes; i++) {
      const b: number = this.byte();
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) return result;
      scale *= 128;
    }
    throw new Malformed('LEB128 too long');
  }

  /** A signed LEB128 of at most `bits` bits; only its extent matters, so the value is not built. */
  sleb(bits: number): void {
    const maxBytes: number = Math.ceil(bits / 7);
    for (let i: number = 0; i < maxBytes; i++) if ((this.byte() & 0x80) === 0) return;
    throw new Malformed('LEB128 too long');
  }

  name(): string {
    const len: number = this.u32();
    if (this.at + len > this.end) throw new Malformed('name past the end');
    let s: string;
    try {
      s = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(this.at, this.at + len));
    } catch {
      throw new Malformed('a name is not UTF-8');
    }
    this.at += len;
    return s;
  }

  /** A sub-reader over the next `len` bytes, which this reader then skips. */
  sub(len: number): Reader {
    const r: Reader = new Reader(this.bytes, this.at, this.at + len);
    this.skip(len);
    return r;
  }

  /** `count` items read by `item`. */
  vec<T>(item: (r: Reader) => T): T[] {
    const count: number = this.u32();
    const out: T[] = [];
    for (let i: number = 0; i < count; i++) out.push(item(this));
    return out;
  }

  expectDone(what: string): void {
    if (!this.done) throw new Malformed(`${what} has trailing bytes`);
  }
}
