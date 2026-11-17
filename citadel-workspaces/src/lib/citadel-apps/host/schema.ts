/**
 * A small decoder DSL: each `Schema<T>` turns a decoded CBOR value into `{v: T}` or null (no
 * match), the way serde would on the Rust side: exact kinds, required fields, externally tagged
 * enums. Used for the guest's call arguments, typed against the generated `OpArgs`, so a schema
 * that drifts from the Rust type fails the type check rather than a call.
 *
 * Normalisations, both deliberate: a u64 arrives as number or bigint by size and leaves as bigint;
 * bytes are accepted as a CBOR byte string, a tag-64 typed array or an array of integers 0..255
 * (all three decode on the Rust side too) and leave as a plain Uint8Array.
 */
import { isCborMap, type CborMap } from './cbor';

export type Parsed<T> = { readonly v: T } | null;
export type Schema<T> = (value: unknown) => Parsed<T>;

const when = <T>(ok: boolean, v: T): Parsed<T> => (ok ? { v } : null);

export const str: Schema<string> = (v) => (typeof v === 'string' ? { v } : null);
export const bool: Schema<boolean> = (v) => (typeof v === 'boolean' ? { v } : null);
/** f32/f64: any finite number. (cbor-x decodes 10.0 as 10, so an integer cannot be told apart and is accepted.) */
export const float: Schema<number> = (v) => when(typeof v === 'number' && Number.isFinite(v), v as number);

function uint(max: number): Schema<number> {
  return (v) => {
    const n: number | null = typeof v === 'number' ? v : typeof v === 'bigint' && v <= BigInt(max) && v >= 0n ? Number(v) : null;
    return n !== null && Number.isInteger(n) && n >= 0 && n <= max ? { v: n } : null;
  };
}
export const u8: Schema<number> = uint(0xff);
export const u16: Schema<number> = uint(0xffff);
export const u32: Schema<number> = uint(0xffff_ffff);
export const i32: Schema<number> = (v) => when(typeof v === 'number' && Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31, v as number);

export const u64: Schema<bigint> = (v) => {
  if (typeof v === 'bigint') return when(v >= 0n && v < 2n ** 64n, v);
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? { v: BigInt(v) } : null;
};

export const bytes: Schema<Uint8Array> = (v) => {
  if (v instanceof Uint8Array) return { v: new Uint8Array(v) };
  if (Array.isArray(v) && v.every((b: unknown) => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255)) {
    return { v: Uint8Array.from(v as number[]) };
  }
  return null;
};

export function literal<const L extends string>(...names: readonly L[]): Schema<L> {
  return (v) => (typeof v === 'string' && (names as readonly string[]).includes(v) ? { v: v as L } : null);
}

/** An Option: CBOR null is None. */
export function nullable<T>(s: Schema<T>): Schema<T | null> {
  return (v) => (v === null ? { v: null } : s(v));
}

export function array<T>(s: Schema<T>): Schema<T[]> {
  return (v) => {
    if (!Array.isArray(v)) return null;
    const out: T[] = [];
    for (const item of v as unknown[]) {
      const r: Parsed<T> = s(item);
      if (r === null) return null;
      out.push(r.v);
    }
    return { v: out };
  };
}

export const pair: Schema<[string, string]> = (v) =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' ? { v: [v[0], v[1]] } : null;

type Fields<T> = { readonly [K in keyof T]-?: Schema<T[K]> };

/** A struct: every field present (an Option is written as null, never omitted, by ciborium). */
export function struct<T extends object>(fields: Fields<T>): Schema<T> {
  return (v) => {
    if (!isCborMap(v)) return null;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(fields) as (keyof T & string)[]) {
      if (!Object.hasOwn(v, key)) return null;
      const r: Parsed<T[keyof T]> = (fields[key] as Schema<T[keyof T]>)((v as CborMap)[key]);
      if (r === null) return null;
      out[key] = r.v;
    }
    return { v: out as T };
  };
}

/** An externally tagged enum: a unit variant is its name, a data variant a one-key map. */
export function tagged<T>(units: readonly string[], variants: Readonly<Record<string, Schema<unknown>>>): Schema<T> {
  return (v) => {
    if (typeof v === 'string') return units.includes(v) ? { v: v as T } : null;
    if (!isCborMap(v)) return null;
    const keys: string[] = Object.keys(v);
    if (keys.length !== 1 || !Object.hasOwn(variants, keys[0])) return null;
    const r: Parsed<unknown> = variants[keys[0]](v[keys[0]]);
    return r === null ? null : { v: { [keys[0]]: r.v } as T };
  };
}

/** An empty struct (`Record<string, never>`): any map, as serde ignores unknown keys. */
export const empty: Schema<Record<string, never>> = (v) => (isCborMap(v) ? { v: {} } : null);
