/**
 * A module's boundary, read straight from its bytes as the Rust inspector's parse.rs reads it:
 * function signatures, every import (with its signature or memory limits), every export (with its
 * signature), the memories it defines, whether it has a start function, and whether it uses
 * threads. Anything outside wasm 2.0 + threads throws `Malformed` (see wasm-code.ts).
 */
import { reftype, valtype, walkBody, walkConstExpr } from './wasm-code';
import { Malformed, Reader } from './wasm-reader';

export interface FuncSig {
  readonly params: readonly number[];
  readonly results: readonly number[];
}

export interface MemoryLimits {
  readonly minPages: number;
  readonly maxPages: number | null;
  readonly shared: boolean;
}

export type ImportKind =
  | { readonly kind: 'function'; readonly sig: FuncSig }
  | { readonly kind: 'memory'; readonly memory: MemoryLimits }
  | { readonly kind: 'table' }
  | { readonly kind: 'global' };

export type BinaryImport = { readonly module: string; readonly name: string } & ImportKind;

export type ExportKind = { readonly kind: 'function'; readonly sig: FuncSig } | { readonly kind: 'table' | 'memory' | 'global' };

export type BinaryExport = { readonly name: string } & ExportKind;

export interface BinaryFacts {
  readonly imports: readonly BinaryImport[];
  readonly exports: readonly BinaryExport[];
  readonly definedMemories: readonly MemoryLimits[];
  readonly hasStart: boolean;
  /** Atomics or a shared memory: valid only with threads. */
  readonly usesThreads: boolean;
}

const MAGIC: readonly number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const S = { custom: 0, type: 1, import: 2, func: 3, table: 4, memory: 5, global: 6, export: 7, start: 8, elem: 9, code: 10, data: 11, dataCount: 12 } as const;

function funcType(r: Reader): FuncSig {
  const form: number = r.byte();
  if (form !== 0x60) throw new Malformed(`type form 0x${form.toString(16)} (GC) is outside wasm 2.0`);
  return { params: r.vec(valtype), results: r.vec(valtype) };
}

/** Memory limits: max bit, shared bit (threads); memory64 and custom page sizes are not wasm 2.0. */
function memoryLimits(r: Reader): MemoryLimits {
  const flags: number = r.u32();
  if ((flags & ~0x03) !== 0) throw new Malformed(`memory flags ${flags} (memory64 or custom pages) are outside wasm 2.0`);
  const minPages: number = r.u64();
  const maxPages: number | null = (flags & 0x01) !== 0 ? r.u64() : null;
  const shared: boolean = (flags & 0x02) !== 0;
  if (shared && maxPages === null) throw new Malformed('a shared memory needs a maximum');
  return { minPages, maxPages, shared };
}

function tableType(r: Reader): void {
  reftype(r);
  const flags: number = r.u32();
  if ((flags & ~0x01) !== 0) throw new Malformed(`table flags ${flags} are outside wasm 2.0`);
  r.u32();
  if (flags === 1) r.u32();
}

function globalType(r: Reader): void {
  valtype(r);
  if (r.byte() > 1) throw new Malformed('bad global mutability');
}

function sigOf(types: readonly FuncSig[], index: number): FuncSig {
  const sig: FuncSig | undefined = types[index];
  if (sig === undefined) throw new Malformed(`type ${index} is not a function type`);
  return sig;
}

/** Flags 0-7: bit 0 passive/declarative, bit 1 explicit table (active) or declarative, bit 2 expressions. */
function element(r: Reader): void {
  const flags: number = r.u32();
  if (flags > 7) throw new Malformed(`element flags ${flags}`);
  if (flags === 2 || flags === 6) r.u32();
  if ((flags & 0x01) === 0) walkConstExpr(r);
  if ((flags & 0x03) !== 0) {
    if ((flags & 0x04) !== 0) reftype(r);
    else if (r.byte() !== 0x00) throw new Malformed('element kind');
  }
  if ((flags & 0x04) !== 0) r.vec(walkConstExpr);
  else r.vec((v: Reader) => v.u32());
}

function data(r: Reader): void {
  const flags: number = r.u32();
  if (flags === 2) {
    if (r.u32() !== 0) throw new Malformed('a second memory (multi-memory) is outside wasm 2.0');
  } else if (flags > 1) throw new Malformed(`data flags ${flags}`);
  if (flags !== 1) walkConstExpr(r);
  r.skip(r.u32());
}

function importEntry(v: Reader, types: readonly FuncSig[], funcTypes: number[]): BinaryImport {
  const module: string = v.name();
  const name: string = v.name();
  const kind: number = v.byte();
  if (kind === 0x00) {
    const t: number = v.u32();
    funcTypes.push(t);
    return { module, name, kind: 'function', sig: sigOf(types, t) };
  }
  if (kind === 0x01) { tableType(v); return { module, name, kind: 'table' }; }
  if (kind === 0x02) return { module, name, kind: 'memory', memory: memoryLimits(v) };
  if (kind === 0x03) { globalType(v); return { module, name, kind: 'global' }; }
  throw new Malformed(`import kind ${kind} (tags) is outside wasm 2.0`);
}

type RawExport = { readonly name: string; readonly kind: number; readonly index: number };

function exportEntry({ name, kind, index }: RawExport, types: readonly FuncSig[], funcTypes: readonly number[]): BinaryExport {
  if (kind === 0x00) {
    const t: number | undefined = funcTypes[index];
    if (t === undefined) throw new Malformed(`export ${name} names no function`);
    return { name, kind: 'function', sig: sigOf(types, t) };
  }
  const other: 'table' | 'memory' | 'global' | undefined = (['table', 'memory', 'global'] as const)[kind - 1];
  if (other === undefined) throw new Malformed(`export kind ${kind} (tags) is outside wasm 2.0`);
  return { name, kind: other };
}

export function readBinaryFacts(bytes: Uint8Array): BinaryFacts {
  if (bytes.byteLength < 8 || MAGIC.some((b: number, i: number) => bytes[i] !== b)) throw new Malformed('not a version-1 core module');
  const top: Reader = new Reader(bytes, 8, bytes.byteLength);
  const types: FuncSig[] = [];
  const funcTypes: number[] = [];
  const imports: BinaryImport[] = [];
  const raw: RawExport[] = [];
  const definedMemories: MemoryLimits[] = [];
  let hasStart: boolean = false;
  let atomics: boolean = false;
  while (!top.done) {
    const id: number = top.byte();
    const r: Reader = top.sub(top.u32());
    if (id === S.custom) continue;
    if (id === S.type) types.push(...r.vec(funcType));
    else if (id === S.import) imports.push(...r.vec((v: Reader) => importEntry(v, types, funcTypes)));
    else if (id === S.func) funcTypes.push(...r.vec((v: Reader) => v.u32()));
    else if (id === S.table) r.vec(tableType);
    else if (id === S.memory) definedMemories.push(...r.vec(memoryLimits));
    else if (id === S.global) r.vec((v: Reader): void => { globalType(v); walkConstExpr(v); });
    else if (id === S.export) raw.push(...r.vec((v: Reader): RawExport => ({ name: v.name(), kind: v.byte(), index: v.u32() })));
    else if (id === S.start) { r.u32(); hasStart = true; }
    else if (id === S.elem) r.vec(element);
    else if (id === S.code) r.vec((v: Reader): void => { atomics = walkBody(v.sub(v.u32())) || atomics; });
    else if (id === S.data) r.vec(data);
    else if (id === S.dataCount) r.u32();
    else throw new Malformed(`section ${id} is outside wasm 2.0`);
    r.expectDone(`section ${id}`);
  }
  const memories: MemoryLimits[] = [...imports.flatMap((i: BinaryImport) => (i.kind === 'memory' ? [i.memory] : [])), ...definedMemories];
  if (memories.length > 1) throw new Malformed('more than one memory (multi-memory) is outside wasm 2.0');
  const exports: BinaryExport[] = raw.map((e: RawExport) => exportEntry(e, types, funcTypes));
  return { imports, exports, definedMemories, hasStart, usesThreads: atomics || memories.some((m: MemoryLimits) => m.shared) };
}
