/**
 * The browser's load verdict for an app module, by the Rust inspector's rules
 * (citadel-app-abi-inspect rules.rs): every reason, in its fixed order, as its `Rejection::code()`
 * string, so a module the kernel refused at publish is refused here for the same reasons, and the
 * fixtures' expectations compare as equal lists.
 *
 * Order: `threads`; then per import (foreign_import / unknown_import / wrong_import_kind /
 * wrong_import_signature / undeclared_group / shared_memory / memory64 / memory_initial_too_large);
 * then memory_not_imported, memory_defined, start_function; then each required export (app_close
 * among them) and app_frame. A module the engine cannot compile, or that is outside wasm 2.0 + threads, is
 * `malformed` alone. The engine's own import list is cross-checked against the bytes.
 */
import {
  ABI_NAMESPACE, EXPORT_FRAME, MEMORY_IMPORT, REPLY_LEN, REPLY_READ, REQUIRED_EXPORTS, isAbiGroup,
} from './abi';
import { declaredGroups, type Capability } from './capabilities';
import { readBinaryFacts, type BinaryExport, type BinaryFacts, type BinaryImport, type FuncSig, type MemoryLimits } from './wasm-binary';

export type LoadVerdict =
  | {
    readonly ok: true;
    readonly module: WebAssembly.Module;
    readonly memory: { readonly minPages: number; readonly maxPages: number | null };
    readonly hasFrame: boolean;
  }
  | { readonly ok: false; readonly reasons: readonly string[] };

const I32: number = 0x7f;
const sig = (params: number, results: number): FuncSig => ({ params: Array<number>(params).fill(I32), results: Array<number>(results).fill(I32) });
const GROUP_SIG: FuncSig = sig(3, 1);
const REPLY_LEN_SIG: FuncSig = sig(1, 1);
const FRAME_SIG: FuncSig = sig(1, 0);
const EXPORT_SIGS: Readonly<Record<(typeof REQUIRED_EXPORTS)[number], FuncSig>> = {
  app_alloc: sig(1, 1), app_free: sig(2, 0), app_init: sig(2, 1), app_event: sig(2, 0), app_close: sig(1, 1),
};

const sameSig = (a: FuncSig, b: FuncSig): boolean =>
  a.params.length === b.params.length && a.results.length === b.results.length
  && a.params.every((t: number, i: number) => t === b.params[i]) && a.results.every((t: number, i: number) => t === b.results[i]);

const MALFORMED: LoadVerdict = { ok: false, reasons: ['malformed'] };

function pushOnce(out: string[], code: string): void {
  if (!out.includes(code)) out.push(code);
}

function expectFunc(imp: BinaryImport, want: FuncSig, out: string[]): void {
  if (imp.kind !== 'function') pushOnce(out, `wrong_import_kind:${imp.name}`);
  else if (!sameSig(imp.sig, want)) pushOnce(out, `wrong_import_signature:${imp.name}`);
}

function memoryRules(m: MemoryLimits, hostMaxPages: number, out: string[]): void {
  if (m.shared) pushOnce(out, 'shared_memory');
  if (m.minPages > hostMaxPages) pushOnce(out, 'memory_initial_too_large');
}

function importRules(imports: readonly BinaryImport[], groups: ReadonlySet<string>, hostMaxPages: number, out: string[]): void {
  for (const imp of imports) {
    if (imp.module !== ABI_NAMESPACE) pushOnce(out, `foreign_import:${imp.module}.${imp.name}`);
    else if (imp.name === MEMORY_IMPORT) {
      if (imp.kind === 'memory') memoryRules(imp.memory, hostMaxPages, out);
      else pushOnce(out, `wrong_import_kind:${imp.name}`);
    } else if (imp.name === REPLY_LEN) expectFunc(imp, REPLY_LEN_SIG, out);
    else if (imp.name === REPLY_READ) expectFunc(imp, GROUP_SIG, out);
    else if (!isAbiGroup(imp.name)) pushOnce(out, `unknown_import:${imp.name}`);
    else {
      expectFunc(imp, GROUP_SIG, out);
      if (!groups.has(imp.name)) pushOnce(out, `undeclared_group:${imp.name}`);
    }
  }
}

function exportRules(exports: readonly BinaryExport[], out: string[]): void {
  const find = (name: string): BinaryExport | undefined => exports.find((e: BinaryExport) => e.name === name);
  for (const name of REQUIRED_EXPORTS) {
    const e: BinaryExport | undefined = find(name);
    if (e === undefined) out.push(`missing_export:${name}`);
    else if (e.kind !== 'function' || !sameSig(e.sig, EXPORT_SIGS[name])) out.push(`wrong_export_signature:${name}`);
  }
  const frame: BinaryExport | undefined = find(EXPORT_FRAME);
  if (frame !== undefined && (frame.kind !== 'function' || !sameSig(frame.sig, FRAME_SIG))) out.push(`wrong_export_signature:${EXPORT_FRAME}`);
}

/** The ABI memory import, as Inspection::memory() finds it. */
function abiMemory(facts: BinaryFacts): MemoryLimits | null {
  for (const imp of facts.imports) if (imp.kind === 'memory' && imp.module === ABI_NAMESPACE) return imp.memory;
  return null;
}

/** Every reason the module may not run, in the Rust inspector's order; empty means accepted. */
export function abiReasons(facts: BinaryFacts, declared: ReadonlySet<Capability>, hostMaxPages: number): string[] {
  const out: string[] = [];
  if (facts.usesThreads) out.push('threads');
  importRules(facts.imports, declaredGroups(declared), hostMaxPages, out);
  if (abiMemory(facts) === null) out.push('memory_not_imported');
  if (facts.definedMemories.length > 0) out.push('memory_defined');
  if (facts.hasStart) out.push('start_function');
  exportRules(facts.exports, out);
  return out;
}

function sameImports(facts: BinaryFacts, engine: readonly WebAssembly.ModuleImportDescriptor[]): boolean {
  if (facts.imports.length !== engine.length) return false;
  return facts.imports.every((imp: BinaryImport, i: number) =>
    imp.module === engine[i].module && imp.name === engine[i].name && imp.kind === engine[i].kind);
}

/** The verdict for a compiled module and its bytes. */
export function inspectModule(bytes: Uint8Array, module: WebAssembly.Module, declared: ReadonlySet<Capability>, hostMaxPages: number): LoadVerdict {
  let facts: BinaryFacts;
  try {
    facts = readBinaryFacts(bytes);
  } catch {
    return MALFORMED;
  }
  if (!sameImports(facts, WebAssembly.Module.imports(module))) return MALFORMED;
  const reasons: string[] = abiReasons(facts, declared, hostMaxPages);
  const memory: MemoryLimits | null = abiMemory(facts);
  if (reasons.length > 0 || memory === null) return { ok: false, reasons };
  return { ok: true, module, memory: { minPages: memory.minPages, maxPages: memory.maxPages }, hasFrame: facts.exports.some((e: BinaryExport) => e.name === EXPORT_FRAME) };
}

/** Compiles (never instantiates) and inspects. Bytes the engine cannot compile are `malformed`. */
export async function inspectArtifact(bytes: Uint8Array, declared: ReadonlySet<Capability>, hostMaxPages: number): Promise<LoadVerdict> {
  let module: WebAssembly.Module;
  try {
    module = await WebAssembly.compile(new Uint8Array(bytes));
  } catch {
    return MALFORMED;
  }
  return inspectModule(bytes, module, declared, hostMaxPages);
}
