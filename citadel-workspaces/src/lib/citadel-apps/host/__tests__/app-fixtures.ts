/**
 * TEST HELPER: ABI-shaped app modules built with wasm-builder, standing in for the Rust guest
 * SDK's fixtures until they land. `appModule()` with no options is the CLEAN module (the control
 * for every hostile variant): memory imported, the two reply readers, the five required exports.
 */
import type { AppContext } from '../../sdk/generated/AppContext';
import { ABI_NAMESPACE, type AbiGroup } from '../abi';
import type { Capability } from '../capabilities';
import { buildModule, I32, op, type FuncSpec, type ImportSpec, type ModuleSpec } from './wasm-builder';

export interface AppModuleOptions {
  /** Group imports, in order after reply_read and reply_len. */
  readonly groups?: readonly AbiGroup[];
  readonly memory?: { readonly min: number; readonly max?: number; readonly shared?: boolean } | 'none';
  readonly extraImports?: readonly ImportSpec[];
  readonly omitExports?: readonly string[];
  /** Bodies; locals 0 and 1 are (ptr, len) for init/event, local 0 is dt for frame. */
  readonly init?: readonly number[];
  readonly event?: readonly number[];
  readonly frame?: readonly number[];
  /** app_close's body; local 0 is the reason code. Answers CLOSE_RESULT.OK when left out. */
  readonly close?: readonly number[];
  readonly start?: boolean;
  readonly data?: ModuleSpec['data'];
}

/** Where app_alloc hands out memory in these fixtures: one fixed region per call is enough. */
export const FIXTURE_ALLOC_PTR: number = 8192;

const fn3 = (n: string): ImportSpec => ({ module: ABI_NAMESPACE, name: n, kind: 'func', params: [I32, I32, I32], results: [I32] });

export function appImports(options: AppModuleOptions): ImportSpec[] {
  const memory: NonNullable<AppModuleOptions['memory']> = options.memory ?? { min: 1, max: 16 };
  const imports: ImportSpec[] = [];
  if (memory !== 'none') imports.push({ module: ABI_NAMESPACE, name: 'memory', kind: 'memory', ...memory });
  imports.push(fn3('reply_read'));
  imports.push({ module: ABI_NAMESPACE, name: 'reply_len', kind: 'func', params: [I32], results: [I32] });
  for (const g of options.groups ?? []) imports.push(fn3(g));
  imports.push(...(options.extraImports ?? []));
  return imports;
}

/** The function index of an imported function, for `op.call`. */
export function importIndex(options: AppModuleOptions, importName: string): number {
  const funcs: ImportSpec[] = appImports(options).filter((i: ImportSpec) => i.kind === 'func');
  const at: number = funcs.findIndex((i: ImportSpec) => i.name === importName);
  if (at < 0) throw new Error(`fixture: no imported function ${importName}`);
  return at;
}

export function appModuleSpec(options: AppModuleOptions = {}): ModuleSpec {
  const omit: ReadonlySet<string> = new Set<string>(options.omitExports ?? []);
  const funcs: FuncSpec[] = [
    { export: 'app_alloc', params: [I32], results: [I32], body: op.i32(FIXTURE_ALLOC_PTR) },
    { export: 'app_free', params: [I32, I32], results: [], body: [] },
    { export: 'app_init', params: [I32, I32], results: [I32], body: options.init ?? op.i32(0) },
    { export: 'app_event', params: [I32, I32], results: [], body: options.event ?? [] },
    { export: 'app_close', params: [I32], results: [I32], body: options.close ?? op.i32(0) },
  ];
  if (options.frame !== undefined) funcs.push({ export: 'app_frame', params: [I32], results: [], body: options.frame });
  const kept: FuncSpec[] = funcs.map((f: FuncSpec): FuncSpec => (f.export !== undefined && omit.has(f.export) ? { ...f, export: undefined } : f));
  if (options.start === true) kept.push({ params: [], results: [], body: [] });
  return {
    imports: appImports(options),
    funcs: kept,
    start: options.start === true ? kept.length - 1 : undefined,
    ownMemory: options.memory === 'none' ? { min: 1 } : undefined,
    data: options.data,
  };
}

export function appModule(options: AppModuleOptions = {}): Uint8Array {
  return buildModule(appModuleSpec(options));
}

/** A body that calls `group(opNumber, ptr, len)` and drops the handle. */
export function callGroup(options: AppModuleOptions, group: AbiGroup, opNumber: number, ptr: number, len: number): number[] {
  return [...op.i32(opNumber), ...op.i32(ptr), ...op.i32(len), ...op.call(importIndex(options, group)), ...op.drop];
}

/** A body that grows memory by `pages` and traps if the grow failed. */
export function growOrTrap(pages: number): number[] {
  return [...op.i32(pages), ...op.memoryGrow, ...op.trapIfMinusOne];
}

/**
 * The close grace these hand-built modules run under: the reference harness's runs use 500 ms
 * (apps/sdk-fixtures/fixtures.json `host.close_grace_ms`), and a test about close timing passes
 * its own; 500 is well inside MAX_CLOSE_GRACE_MS and long enough for a close that settles at once.
 */
export const FIXTURE_CLOSE_GRACE_MS: number = 500;

/** The reference harness's context (harness/src/lib.rs `context`), so runs compare like for like. */
export function fixtureContext(granted: readonly Capability[], closeGraceMs: number): AppContext {
  return {
    app_id: 'net.avarok.fixture', install_id: 'install-1', scope: 'workspace', granted: [...granted].sort(), surface: 'canvas_pane',
    size: { width: 320, height: 200 }, dpr: 1, theme: {}, locale: 'en', acting_username: 'alice', node_id: 'root',
    close_grace_ms: closeGraceMs,
  };
}
