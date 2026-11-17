/**
 * TEST HELPER: emits minimal core wasm modules byte by byte, so the host can be exercised before
 * the Rust guest SDK's fixtures exist. Only the encodings the tests need: function types, imports
 * (functions and memories, shared or not), defined functions, an own memory, exports, a start
 * function and active data segments. When the real fixtures land they are loaded beside these.
 */

export const I32: 0x7f = 0x7f;
type ValType = typeof I32;

export type ImportSpec =
  | { readonly module: string; readonly name: string; readonly kind: 'func'; readonly params: readonly ValType[]; readonly results: readonly ValType[] }
  | { readonly module: string; readonly name: string; readonly kind: 'memory'; readonly min: number; readonly max?: number; readonly shared?: boolean }
  | { readonly module: string; readonly name: string; readonly kind: 'global' };

export interface FuncSpec {
  readonly export?: string;
  readonly params: readonly ValType[];
  readonly results: readonly ValType[];
  /** The body's instructions, without the trailing `end`. */
  readonly body: readonly number[];
}

export interface ModuleSpec {
  readonly imports: readonly ImportSpec[];
  readonly funcs: readonly FuncSpec[];
  /** Index into `funcs` (not counting imported functions). */
  readonly start?: number;
  readonly ownMemory?: { readonly min: number };
  readonly data?: readonly { readonly offset: number; readonly bytes: Uint8Array }[];
}

export function uleb(n: number): number[] {
  const out: number[] = [];
  let v: number = n;
  do {
    let byte: number = v & 0x7f;
    v = Math.floor(v / 128);
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

export function sleb(n: number): number[] {
  const out: number[] = [];
  let v: number = n;
  for (;;) {
    const byte: number = v & 0x7f;
    v >>= 7;
    const done: boolean = (v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}

const name = (s: string): number[] => {
  const bytes: number[] = Array.from(new TextEncoder().encode(s));
  return [...uleb(bytes.length), ...bytes];
};
const vec = (items: readonly number[][]): number[] => [...uleb(items.length), ...items.flat()];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const limits = (min: number, max: number | undefined, shared: boolean): number[] =>
  max === undefined ? [0x00, ...uleb(min)] : [shared ? 0x03 : 0x01, ...uleb(min), ...uleb(max)];

export function buildModule(spec: ModuleSpec): Uint8Array {
  const types: string[] = [];
  const typeIndex = (params: readonly ValType[], results: readonly ValType[]): number => {
    const key: string = `${params.join(',')}>${results.join(',')}`;
    if (!types.includes(key)) types.push(key);
    return types.indexOf(key);
  };
  const importEntries: number[][] = spec.imports.map((imp: ImportSpec): number[] => {
    const head: number[] = [...name(imp.module), ...name(imp.name)];
    if (imp.kind === 'func') return [...head, 0x00, ...uleb(typeIndex(imp.params, imp.results))];
    if (imp.kind === 'memory') return [...head, 0x02, ...limits(imp.min, imp.max, imp.shared === true)];
    return [...head, 0x03, I32, 0x00];
  });
  const funcTypes: number[][] = spec.funcs.map((f: FuncSpec): number[] => uleb(typeIndex(f.params, f.results)));
  const importedFuncs: number = spec.imports.filter((i: ImportSpec) => i.kind === 'func').length;
  const exports: number[][] = spec.funcs.flatMap((f: FuncSpec, i: number): number[][] =>
    f.export === undefined ? [] : [[...name(f.export), 0x00, ...uleb(importedFuncs + i)]]);
  const bodies: number[][] = spec.funcs.map((f: FuncSpec): number[] => {
    const body: number[] = [0x00, ...f.body, 0x0b];
    return [...uleb(body.length), ...body];
  });
  const typeEntries: number[][] = types.map((key: string): number[] => {
    const [p, r] = key.split('>').map((s: string): number[] => (s === '' ? [] : s.split(',').map(Number)));
    return [0x60, ...uleb(p.length), ...p, ...uleb(r.length), ...r];
  });
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  out.push(...section(1, vec(typeEntries)));
  if (importEntries.length > 0) out.push(...section(2, vec(importEntries)));
  out.push(...section(3, vec(funcTypes)));
  if (spec.ownMemory !== undefined) out.push(...section(5, vec([limits(spec.ownMemory.min, undefined, false)])));
  out.push(...section(7, vec(exports)));
  if (spec.start !== undefined) out.push(...section(8, uleb(importedFuncs + spec.start)));
  out.push(...section(10, vec(bodies)));
  if (spec.data !== undefined && spec.data.length > 0) {
    out.push(...section(11, vec(spec.data.map((d) => [0x00, 0x41, ...sleb(d.offset), 0x0b, ...uleb(d.bytes.length), ...d.bytes]))));
  }
  return Uint8Array.from(out);
}

/** Instruction helpers for bodies. */
export const op = {
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  localGet: (i: number): number[] => [0x20, ...uleb(i)],
  call: (i: number): number[] => [0x10, ...uleb(i)],
  drop: [0x1a],
  /** loop br 0 end: never returns. */
  spin: [0x03, 0x40, 0x0c, 0x00, 0x0b],
  /** memory.grow on memory 0. */
  memoryGrow: [0x40, 0x00],
  unreachable: [0x00],
  /** if (top == -1) unreachable */
  trapIfMinusOne: [0x41, 0x7f, 0x46, 0x04, 0x40, 0x00, 0x0b],
  /** i32.store offset=0 align=2 */
  store: [0x36, 0x02, 0x00],
} as const;
