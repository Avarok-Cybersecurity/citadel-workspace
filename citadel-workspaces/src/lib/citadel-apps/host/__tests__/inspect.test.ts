/**
 * The load verdict, by the Rust inspector's rules and codes: every reason, in its order. Each
 * hostile module is the clean one with exactly one thing changed, and the clean module loading is
 * the control that makes each refusal mean something. (The real fixtures, against fixtures.json,
 * are sdk-fixtures.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { ABI_NAMESPACE } from '../abi';
import type { Capability } from '../capabilities';
import { inspectArtifact, type LoadVerdict } from '../inspect';
import { appModule, appModuleSpec, type AppModuleOptions } from './app-fixtures';
import { I32, buildModule, type FuncSpec, type ImportSpec, type ModuleSpec } from './wasm-builder';

const NONE: ReadonlySet<Capability> = new Set<Capability>();
const MAX_PAGES: number = 64;

const verdict = (options: AppModuleOptions, declared: ReadonlySet<Capability> = NONE): Promise<LoadVerdict> =>
  inspectArtifact(appModule(options), declared, MAX_PAGES);

const reasons = async (bytes: Uint8Array, declared: ReadonlySet<Capability> = NONE): Promise<readonly string[]> => {
  const v: LoadVerdict = await inspectArtifact(bytes, declared, MAX_PAGES);
  return v.ok ? [] : v.reasons;
};
const refused = (options: AppModuleOptions, declared: ReadonlySet<Capability> = NONE): Promise<readonly string[]> => reasons(appModule(options), declared);

const fn = (module: string, name: string, params: readonly (typeof I32)[] = [I32, I32, I32]): ImportSpec => ({ module, name, kind: 'func', params, results: [I32] });

describe('the clean module (control)', () => {
  it('loads, with its memory limits and whether it has a frame export', async () => {
    const v: LoadVerdict = await verdict({ groups: ['canvas', 'log'], frame: [] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.memory).toEqual({ minPages: 1, maxPages: 16 });
    expect(v.hasFrame).toBe(true);
    expect(v.module).toBeInstanceOf(WebAssembly.Module);
  });

  it('loads with every intrinsic group and a declared one', async () => {
    expect((await verdict({ groups: ['canvas', 'ui', 'events', 'navigate', 'log', 'net'] }, new Set<Capability>(['net.server']))).ok).toBe(true);
  });
});

describe('hostile modules are refused with the Rust codes', () => {
  it('foreign imports name their module and field', async () => {
    expect(await refused({ extraImports: [fn('env', 'fetch'), fn('wasi_snapshot_preview1', 'fd_write')] }))
      .toEqual(['foreign_import:env.fetch', 'foreign_import:wasi_snapshot_preview1.fd_write']);
  });

  it('a name that is not in the ABI, inside the namespace', async () => {
    expect(await refused({ extraImports: [fn(ABI_NAMESPACE, 'eval')] })).toEqual(['unknown_import:eval']);
  });

  it('a group its manifest does not declare (control: declared, it loads)', async () => {
    expect(await refused({ groups: ['net'] })).toEqual(['undeclared_group:net']);
    expect((await verdict({ groups: ['net'] }, new Set<Capability>(['net.host']))).ok).toBe(true);
  });

  it('an ABI name of the wrong kind or signature', async () => {
    expect(await refused({ extraImports: [{ module: ABI_NAMESPACE, name: 'log', kind: 'global' }] })).toEqual(['wrong_import_kind:log']);
    expect(await refused({ extraImports: [fn(ABI_NAMESPACE, 'nodes', [I32])] }, new Set<Capability>(['nodes.read']))).toEqual(['wrong_import_signature:nodes']);
  });

  it('a start function', async () => {
    expect(await refused({ start: true })).toEqual(['start_function']);
  });

  it('a shared memory is threads and shared_memory', async () => {
    expect(await refused({ memory: { min: 1, max: 16, shared: true } })).toEqual(['threads', 'shared_memory']);
  });

  it('an atomic instruction on an unshared memory is threads (control: the plain load passes)', async () => {
    const atomicLoad: number[] = [0x41, 0x00, 0xfe, 0x10, 0x02, 0x00, 0x1a];
    expect(await refused({ event: atomicLoad })).toEqual(['threads']);
    expect(await refused({ event: [0x41, 0x00, 0x28, 0x02, 0x00, 0x1a] })).toEqual([]);
  });

  it('an instruction outside wasm 2.0 the engine accepts is malformed (control: sign-extension, which is wasm 2.0)', async () => {
    // return_call app_free (function 3): tail calls, which the engine runs and wasm 2.0 does not have.
    const returnCall: number[] = [0x41, 0x00, 0x41, 0x00, 0x12, 0x03];
    expect(await refused({ event: returnCall })).toEqual(['malformed']);
    expect(await refused({ event: [0x41, 0x00, 0xc0, 0x1a] })).toEqual([]);
  });

  it('defining its own memory instead of importing one', async () => {
    expect(await refused({ memory: 'none' })).toEqual(['memory_not_imported', 'memory_defined']);
  });

  it('more initial memory than the host maximum (control: exactly the maximum loads)', async () => {
    expect(await refused({ memory: { min: MAX_PAGES + 1 } })).toEqual(['memory_initial_too_large']);
    expect(await refused({ memory: { min: MAX_PAGES } })).toEqual([]);
  });

  for (const name of ['app_alloc', 'app_free', 'app_init', 'app_event']) {
    it(`lacking the required export ${name}`, async () => {
      expect(await refused({ omitExports: [name] })).toEqual([`missing_export:${name}`]);
    });
  }

  it('a required export with the wrong signature', async () => {
    const spec: ModuleSpec = appModuleSpec({});
    const funcs: FuncSpec[] = spec.funcs.map((f) => (f.export === 'app_init' ? { ...f, params: [I32] as const, body: [0x41, 0x00] } : f));
    expect(await reasons(buildModule({ ...spec, funcs }))).toEqual(['wrong_export_signature:app_init']);
  });

  it('every reason at once, in the Rust order', async () => {
    expect(await refused({ extraImports: [fn('env', 'fetch')], groups: ['net'], start: true, omitExports: ['app_free'] }))
      .toEqual(['undeclared_group:net', 'foreign_import:env.fetch', 'start_function', 'missing_export:app_free']);
  });

  it('bytes that are not a wasm module are malformed', async () => {
    expect(await reasons(new TextEncoder().encode('<script>alert(1)</script>'))).toEqual(['malformed']);
  });

  it('a module with no imports at all', async () => {
    const bare: Uint8Array = buildModule({ imports: [], funcs: [{ export: 'app_init', params: [I32, I32], results: [I32], body: [0x41, 0x00] }] });
    expect(await reasons(bare)).toEqual(['memory_not_imported', 'missing_export:app_alloc', 'missing_export:app_free', 'missing_export:app_event', 'missing_export:app_close']);
  });

});
