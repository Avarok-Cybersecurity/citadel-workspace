/**
 * The app ABI's CBOR, both ways.
 *
 * Encoding is the host's own, because the guest decodes with ciborium, which is strict about
 * kinds: an `f32` field refuses a CBOR integer, and a JS number cannot say whether `1` meant
 * `1u32` or `1.0f32`. So a float is written as a float only when it is wrapped in `CborFloat`
 * (see `f32()`); every other number must be an integer and is written as one. Byte arrays are
 * byte strings (major type 2, never tag 64), bigints are integers, objects are maps with string
 * keys in insertion order. Anything else (undefined, a function, a Map) throws: the host builds
 * every value it encodes, so that is a host bug, not guest input.
 *
 * Decoding is cbor-x, never throwing: hostile bytes, or trailing bytes after one item, are
 * `{ok: false}`.
 */
import { Decoder } from 'cbor-x';

export class CborFloat {
  constructor(readonly value: number) {}
}

export const f32 = (value: number): CborFloat => new CborFloat(value);

const TEXT: TextEncoder = new TextEncoder();

function head(out: number[], major: number, n: bigint): void {
  const m: number = major << 5;
  if (n < 24n) out.push(m | Number(n));
  else if (n < 0x100n) out.push(m | 24, Number(n));
  else if (n < 0x10000n) out.push(m | 25, Number(n >> 8n), Number(n & 0xffn));
  else if (n < 0x1_0000_0000n) {
    out.push(m | 26);
    for (let s: bigint = 24n; s >= 0n; s -= 8n) out.push(Number((n >> s) & 0xffn));
  } else if (n < 2n ** 64n) {
    out.push(m | 27);
    for (let s: bigint = 56n; s >= 0n; s -= 8n) out.push(Number((n >> s) & 0xffn));
  } else throw new Error('cbor: integer out of the 64-bit range');
}

function write(out: number[], value: unknown): void {
  if (value === null) out.push(0xf6);
  else if (value === true) out.push(0xf5);
  else if (value === false) out.push(0xf4);
  else if (typeof value === 'bigint') {
    if (value >= 0n) head(out, 0, value);
    else head(out, 1, -1n - value);
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`cbor: ${value} is not an integer; wrap a float in f32()`);
    write(out, BigInt(value));
  } else if (value instanceof CborFloat) {
    const b: DataView = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, value.value);
    out.push(0xfb, ...new Uint8Array(b.buffer));
  } else if (typeof value === 'string') {
    const bytes: Uint8Array = TEXT.encode(value);
    head(out, 3, BigInt(bytes.byteLength));
    for (const x of bytes) out.push(x);
  } else if (value instanceof Uint8Array) {
    head(out, 2, BigInt(value.byteLength));
    for (const x of value) out.push(x);
  } else if (Array.isArray(value)) {
    head(out, 4, BigInt(value.length));
    for (const item of value) write(out, item);
  } else if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries: [string, unknown][] = Object.entries(value as Record<string, unknown>);
    head(out, 5, BigInt(entries.length));
    for (const [k, v] of entries) {
      write(out, k);
      write(out, v);
    }
  } else throw new Error(`cbor: cannot encode ${typeof value}`);
}

export function encodeCbor(value: unknown): Uint8Array {
  const out: number[] = [];
  write(out, value);
  return Uint8Array.from(out);
}

const decoder: Decoder = new Decoder({ useRecords: false, mapsAsObjects: true });

export type Decoded = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export function decodeCbor(bytes: Uint8Array): Decoded {
  if (bytes.byteLength === 0) return { ok: false };
  try {
    return { ok: true, value: decoder.decode(bytes) };
  } catch {
    return { ok: false };
  }
}

export type CborMap = Readonly<Record<string, unknown>>;

/** A decoded CBOR map with string keys. */
export function isCborMap(value: unknown): value is CborMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value) && !(value instanceof Map);
}
