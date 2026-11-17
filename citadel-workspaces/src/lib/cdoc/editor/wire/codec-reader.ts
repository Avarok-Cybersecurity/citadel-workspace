/**
 * Reads a model value in the cdoc_crdt codec (docs/edit-commands.md `value`): the JSON data
 * model in bytes. Integers are numbers when safe and bigints beyond; a map's keys must be
 * strings, as every model value's are. There is no float tag, so none can arrive.
 */
import { RecordError } from './record-writer';

const utf8: TextDecoder = new TextDecoder('utf-8', { fatal: true });

export type CodecValue = null | boolean | number | bigint | string | Uint8Array | readonly CodecValue[] | { readonly [key: string]: CodecValue };

export class CodecReader {
  private at: number = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private byte(): number {
    if (this.at >= this.bytes.length) throw new RecordError('value truncated');
    return this.bytes[this.at++];
  }

  private uv(): bigint {
    let v: bigint = 0n;
    for (let shift: bigint = 0n; shift < 64n; shift += 7n) {
      const b: number = this.byte();
      if (shift === 63n && b > 1) throw new RecordError('value varint overflows 64 bits');
      v |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return v;
    }
    throw new RecordError('value varint overflows 64 bits');
  }

  private count(): number {
    const n: bigint = this.uv();
    if (n > BigInt(this.bytes.length - this.at)) throw new RecordError(`value claims ${n} items in ${this.bytes.length - this.at} bytes`);
    return Number(n);
  }

  private raw(): Uint8Array {
    const n: number = this.count();
    const out: Uint8Array = this.bytes.slice(this.at, this.at + n);
    this.at += n;
    return out;
  }

  private integer(v: bigint): number | bigint {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }

  value(): CodecValue {
    const tag: number = this.byte();
    switch (tag) {
      case 0: return null;
      case 1: return false;
      case 2: return true;
      case 3: return this.integer(this.uv());
      case 4: return this.integer(-1n - this.uv());
      case 5: return utf8.decode(this.raw());
      case 6: return this.raw();
      case 7: return Array.from({ length: this.count() }, (): CodecValue => this.value());
      case 8: {
        const out: Record<string, CodecValue> = {};
        const n: number = this.count();
        for (let i: number = 0; i < n; i++) {
          const key: CodecValue = this.value();
          if (typeof key !== 'string') throw new RecordError('a model value map key is not a string');
          out[key] = this.value();
        }
        return out;
      }
      default: throw new RecordError(`value tag ${tag}`);
    }
  }

  end(): void {
    if (this.at !== this.bytes.length) throw new RecordError(`${this.bytes.length - this.at} trailing byte(s) in a value`);
  }
}

/** One whole value from `bytes`. */
export function readValue(bytes: Uint8Array): CodecValue {
  const r: CodecReader = new CodecReader(bytes);
  const v: CodecValue = r.value();
  r.end();
  return v;
}

export function isMap(v: CodecValue): v is { readonly [key: string]: CodecValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}
