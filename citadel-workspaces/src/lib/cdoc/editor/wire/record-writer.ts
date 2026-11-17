/**
 * Writes editor records (citadel-docs docs/edit-commands.md): `u8`, LEB128 `uv`, zigzag `zz`,
 * length-prefixed `str` and `bytes`, and model `value`s in the cdoc_crdt codec. Integers are
 * checked rather than truncated: a non-integer, an unsafe integer or one outside its field's
 * range throws, because the engine would read a different number than the caller meant.
 */
const MAX_U64: bigint = (1n << 64n) - 1n;
const I32_MIN: number = -0x8000_0000;
const I32_MAX: number = 0x7fff_ffff;

const CODEC_NULL: number = 0;
const CODEC_FALSE: number = 1;
const CODEC_TRUE: number = 2;
const CODEC_UINT: number = 3;
const CODEC_NINT: number = 4;
const CODEC_STR: number = 5;
const CODEC_BYTES: number = 6;
const CODEC_SEQ: number = 7;
const CODEC_MAP: number = 8;

export class RecordError extends Error {
  constructor(message: string) {
    super(`editor record: ${message}`);
    this.name = 'RecordError';
  }
}

const utf8: TextEncoder = new TextEncoder();

function checkedInteger(v: number | bigint, what: string): bigint {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new RecordError(`${what} ${v} is not a safe integer`);
  return BigInt(v);
}

export class RecordWriter {
  private buf: Uint8Array = new Uint8Array(64);
  private at: number = 0;

  private reserve(n: number): void {
    if (this.at + n <= this.buf.length) return;
    const next: Uint8Array = new Uint8Array(Math.max(this.buf.length * 2, this.at + n));
    next.set(this.buf.subarray(0, this.at));
    this.buf = next;
  }

  u8(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new RecordError(`u8 ${v} is out of range`);
    this.reserve(1);
    this.buf[this.at++] = v;
    return this;
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  uv(value: number | bigint, what: string = 'uv'): this {
    let v: bigint = checkedInteger(value, what);
    if (v < 0n || v > MAX_U64) throw new RecordError(`${what} ${v} is not a u64`);
    this.reserve(10);
    while (v >= 0x80n) {
      this.buf[this.at++] = Number(v & 0x7fn) | 0x80;
      v >>= 7n;
    }
    this.buf[this.at++] = Number(v);
    return this;
  }

  zz(value: number | bigint, what: string = 'zz'): this {
    const v: bigint = checkedInteger(value, what);
    return this.uv(v >= 0n ? v << 1n : ((-v) << 1n) - 1n, what);
  }

  /** A Pt100 coordinate or length: an integer that fits an i32. */
  pt(v: number, what: string): this {
    if (!Number.isInteger(v) || v < I32_MIN || v > I32_MAX) throw new RecordError(`${what} ${v} is not an i32 Pt100`);
    return this.zz(v, what);
  }

  raw(bytes: Uint8Array): this {
    this.reserve(bytes.length);
    this.buf.set(bytes, this.at);
    this.at += bytes.length;
    return this;
  }

  bytes(bytes: Uint8Array): this {
    return this.uv(bytes.length).raw(bytes);
  }

  str(text: string): this {
    return this.bytes(utf8.encode(text));
  }

  /** A model value as `bytes` holding its codec encoding. */
  value(v: unknown): this {
    return this.bytes(new RecordWriter().codec(v, 'value').finish());
  }

  private codec(v: unknown, path: string): this {
    if (v === null) return this.u8(CODEC_NULL);
    if (typeof v === 'boolean') return this.u8(v ? CODEC_TRUE : CODEC_FALSE);
    if (typeof v === 'number' || typeof v === 'bigint') {
      const n: bigint = checkedInteger(v, path);
      return n >= 0n ? this.u8(CODEC_UINT).uv(n, path) : this.u8(CODEC_NINT).uv(-1n - n, path);
    }
    if (typeof v === 'string') return this.u8(CODEC_STR).str(v);
    if (v instanceof Uint8Array) return this.u8(CODEC_BYTES).bytes(v);
    if (Array.isArray(v)) {
      this.u8(CODEC_SEQ).uv(v.length);
      v.forEach((item: unknown, i: number) => this.codec(item, `${path}[${i}]`));
      return this;
    }
    if (typeof v === 'object') {
      // Absent optional fields are omitted, as the model's serde omits them.
      const entries: Array<[string, unknown]> = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
      this.u8(CODEC_MAP).uv(entries.length);
      for (const [key, item] of entries) this.u8(CODEC_STR).str(key).codec(item, `${path}.${key}`);
      return this;
    }
    throw new RecordError(`${path} is a ${typeof v}, which a model value cannot hold`);
  }

  /** The record, in a buffer of its own (transferable). */
  finish(): Uint8Array {
    return this.buf.slice(0, this.at);
  }
}
