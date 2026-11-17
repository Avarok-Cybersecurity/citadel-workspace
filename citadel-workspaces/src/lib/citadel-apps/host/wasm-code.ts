/**
 * Instruction-level reading for the inspector's feature check. The engine accepts more than the
 * ABI does (threads, tail calls, exceptions, GC, relaxed SIMD, extended-const, ...); the Rust
 * inspector validates under wasm 2.0 and, failing that, under wasm 2.0 + threads. This walks every
 * function body and constant expression with wasm 2.0's immediates: an atomic (0xFE) marks the
 * module as using threads; any opcode outside wasm 2.0 + threads is `Malformed`. The engine has
 * already validated the module, so only the opcode set is decided here, not typing.
 */
import { Malformed, type Reader } from './wasm-reader';

/** Wasm 2.0 value types: i32 i64 f32 f64 v128 funcref externref. */
const VALTYPES: ReadonlySet<number> = new Set<number>([0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f]);
const REFTYPES: ReadonlySet<number> = new Set<number>([0x70, 0x6f]);

export function valtype(r: Reader): number {
  const t: number = r.byte();
  if (!VALTYPES.has(t)) throw new Malformed(`value type 0x${t.toString(16)} is outside wasm 2.0`);
  return t;
}

export function reftype(r: Reader): number {
  const t: number = r.byte();
  if (!REFTYPES.has(t)) throw new Malformed(`reference type 0x${t.toString(16)} is outside wasm 2.0`);
  return t;
}

/** Wasm 2.0 has one memory: a memory index or reserved byte must be zero. */
function memoryZero(r: Reader): void {
  if (r.u32() !== 0) throw new Malformed('a second memory (multi-memory) is outside wasm 2.0');
}

function memarg(r: Reader): void {
  if (r.u32() >= 64) throw new Malformed('a memarg naming a memory (multi-memory) is outside wasm 2.0');
  r.u64();
}

function blocktype(r: Reader): void {
  const b: number = r.byte();
  if (b === 0x40 || VALTYPES.has(b)) return;
  if ((b & 0x80) === 0 && (b & 0x40) !== 0) throw new Malformed(`block type 0x${b.toString(16)} is outside wasm 2.0`);
  // A type index (s33): b was its first byte.
  if ((b & 0x80) !== 0) r.sleb(33 - 7);
}

/** 0xFC: saturating truncation (0-7), bulk memory and table ops (8-17). */
function misc(r: Reader): void {
  const sub: number = r.u32();
  if (sub <= 7) return;
  if (sub === 8) { r.u32(); memoryZero(r); return; }
  if (sub === 9 || sub === 13 || sub === 15 || sub === 16 || sub === 17) { r.u32(); return; }
  if (sub === 10) { memoryZero(r); memoryZero(r); return; }
  if (sub === 11) { memoryZero(r); return; }
  if (sub === 12 || sub === 14) { r.u32(); r.u32(); return; }
  throw new Malformed(`0xfc ${sub} is outside wasm 2.0`);
}

/** 0xFD: SIMD 128 (relaxed SIMD, 0x100 and up, is not wasm 2.0). */
function simd(r: Reader): void {
  const sub: number = r.u32();
  if (sub > 0xff) throw new Malformed(`0xfd ${sub} (relaxed SIMD) is outside wasm 2.0`);
  if (sub <= 11 || sub === 92 || sub === 93) memarg(r);
  else if (sub === 12 || sub === 13) r.skip(16);
  else if (sub >= 21 && sub <= 34) r.byte();
  else if (sub >= 84 && sub <= 91) { memarg(r); r.byte(); }
}

/** 0xFE: threads. atomic.fence (3) has a reserved byte; every other atomic has a memarg. */
function atomic(r: Reader): void {
  if (r.u32() === 3) r.byte();
  else memarg(r);
}

/** One instruction after its opcode byte; true when it was an atomic. */
function instruction(r: Reader, op: number): boolean {
  if (op === 0xfe) {
    atomic(r);
    return true;
  }
  operands(r, op);
  return false;
}

/** The immediates of a wasm 2.0 instruction (not an atomic). */
function operands(r: Reader, op: number): void {
  if (op <= 0x01 || op === 0x05 || op === 0x0b || op === 0x0f || op === 0x1a || op === 0x1b || op === 0xd1) return;
  if (op >= 0x45 && op <= 0xc4) return;
  if (op >= 0x02 && op <= 0x04) blocktype(r);
  else if (op === 0x0c || op === 0x0d || op === 0x10 || op === 0xd2 || (op >= 0x20 && op <= 0x26)) r.u32();
  else if (op === 0x0e) { r.vec((v: Reader) => v.u32()); r.u32(); }
  else if (op === 0x11) { r.u32(); r.u32(); }
  else if (op === 0x1c) r.vec(valtype);
  else if (op >= 0x28 && op <= 0x3e) memarg(r);
  else if (op === 0x3f || op === 0x40) memoryZero(r);
  else if (op === 0x41) r.sleb(32);
  else if (op === 0x42) r.sleb(64);
  else if (op === 0x43) r.skip(4);
  else if (op === 0x44) r.skip(8);
  else if (op === 0xd0) reftype(r);
  else if (op === 0xfc) misc(r);
  else if (op === 0xfd) simd(r);
  else throw new Malformed(`opcode 0x${op.toString(16)} is outside wasm 2.0`);
}

/** A function body (locals, then code to its final `end`); true when it uses an atomic. */
export function walkBody(r: Reader): boolean {
  r.vec((v: Reader): void => {
    v.u32();
    valtype(v);
  });
  let threads: boolean = false;
  while (!r.done) threads = instruction(r, r.byte()) || threads;
  return threads;
}

/** Wasm 2.0 constant instructions (extended-const's arithmetic is not one). */
const CONSTANT: ReadonlySet<number> = new Set<number>([0x41, 0x42, 0x43, 0x44, 0x23, 0xd0, 0xd2, 0xfd]);

/** A constant expression up to and including its `end`. */
export function walkConstExpr(r: Reader): void {
  for (;;) {
    const op: number = r.byte();
    if (op === 0x0b) return;
    if (!CONSTANT.has(op)) throw new Malformed(`opcode 0x${op.toString(16)} in a constant expression is outside wasm 2.0`);
    if (op === 0xfd) {
      if (r.u32() !== 12) throw new Malformed('only v128.const is constant');
      r.skip(16);
    } else {
      operands(r, op);
    }
  }
}
