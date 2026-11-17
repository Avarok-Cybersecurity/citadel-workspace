/**
 * The import object, driven by a real wasm module (the guest's side of the ABI) and directly.
 * Ungranted groups only ever answer `ungranted`; the control is the same call granted, reaching a
 * fake port and coming back through a pending handle.
 */
import { describe, expect, it } from 'vitest';
import { ABI_ERROR, ABI_GROUPS, ABI_NAMESPACE, type AbiGroup } from '../abi';
import { decodeCbor, encodeCbor, type Decoded } from '../cbor';
import type { Capability } from '../capabilities';
import { Dispatcher } from '../dispatch';
import { IhttpRouter } from '../ihttp-router';
import { buildImports, type CallSink } from '../imports';
import { directInvoker } from '../invoker';
import { STANDARD_HOST_POLICY } from '../limits';
import type { HostPorts } from '../ports';
import { ReplyTable } from '../reply-table';
import { appModule, importIndex, type AppModuleOptions } from './app-fixtures';
import { fakeNodes, ManualClock, type Recorder } from './fakes';
import { op } from './wasm-builder';

const withNodes = (rec: Recorder): HostPorts => ({ nodes: fakeNodes(rec) });
const REQUEST_AT: number = 100;
const REPLY_AT: number = 4096;
const request: Uint8Array = encodeCbor({ node_id: 'n1' });

/** init: handle = nodes(1, req) -> mem[0]; mem[4] = reply_read(handle, REPLY_AT, 256). event: re-read. */
function readerModule(): Uint8Array {
  const base: AppModuleOptions = { groups: ['nodes'], memory: { min: 1, max: 4 } };
  const nodes: number = importIndex(base, 'nodes');
  const replyRead: number = importIndex(base, 'reply_read');
  const read: number[] = [...op.i32(4), ...op.i32(0), 0x28, 0x02, 0x00, ...op.i32(REPLY_AT), ...op.i32(256), ...op.call(replyRead), ...op.store];
  const init: number[] = [...op.i32(0), ...op.i32(1), ...op.i32(REQUEST_AT), ...op.i32(request.byteLength), ...op.call(nodes), ...op.store, ...read, ...op.i32(0)];
  return appModule({ ...base, init, event: read, data: [{ offset: REQUEST_AT, bytes: request }] });
}

interface Live {
  readonly memory: WebAssembly.Memory;
  readonly exports: WebAssembly.Exports;
  readonly ready: number[];
  readonly rec: Recorder;
}

async function instantiate(granted: readonly Capability[], ports: (rec: Recorder) => HostPorts): Promise<Live> {
  const rec: Recorder = { calls: [] };
  const memory: WebAssembly.Memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  const ready: number[] = [];
  const grant: ReadonlySet<Capability> = new Set<Capability>(granted);
  const dispatcher: Dispatcher = new Dispatcher({
    granted: new Set<Capability>(['canvas', 'ui', 'events', 'navigate', 'log', ...granted]), policy: STANDARD_HOST_POLICY,
    clock: new ManualClock(), invoker: directInvoker(ports(rec)), router: new IhttpRouter('a.b', STANDARD_HOST_POLICY.ihttp, null), pageUrl: 'https://work.avarok.net/', routerActions: (): void => {}, topics: null,
  });
  const clock: ManualClock = new ManualClock();
  const sink: CallSink = { call: (g, o, r) => dispatcher.call(g, o, r), replies: new ReplyTable(8, STANDARD_HOST_POLICY.replyTtlMs, clock.now), replyReady: (h: number) => ready.push(h), gate: () => null };
  const { instance } = await WebAssembly.instantiate(readerModule(), buildImports(grant, memory, sink)) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  return { memory, exports: instance.exports, ready, rec };
}

const i32At = (m: WebAssembly.Memory, at: number): number => new DataView(m.buffer).getInt32(at, true);
const replyAt = (m: WebAssembly.Memory): unknown => {
  const n: number = i32At(m, 4);
  const d: Decoded = decodeCbor(new Uint8Array(m.buffer, REPLY_AT, n).slice());
  return d.ok ? d.value : `undecodable (${n})`;
};

describe('a real module calling through the imports', () => {
  it('an ungranted group answers {refused: "ungranted"} and never reaches the port', async () => {
    const live: Live = await instantiate([], withNodes);
    expect((live.exports.app_init as (p: number, l: number) => number)(0, 0)).toBe(0);
    expect(replyAt(live.memory)).toEqual({ refused: 'ungranted' });
    expect(live.rec.calls).toEqual([]);
  });

  it('control: granted, the call reaches the fake port and the reply arrives through a pending handle', async () => {
    const live: Live = await instantiate(['nodes.read'], withNodes);
    (live.exports.app_init as (p: number, l: number) => number)(0, 0);
    expect(i32At(live.memory, 4)).toBe(ABI_ERROR.PENDING);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(live.ready).toEqual([i32At(live.memory, 0)]);
    (live.exports.app_event as (p: number, l: number) => void)(0, 0);
    expect(replyAt(live.memory)).toMatchObject({ ok: { node_id: 'n1', name: 'Board' } });
    expect(live.rec.calls).toEqual([{ method: 'NodeGet', args: { node_id: 'n1' } }]);
  });
});

describe('the import object directly', () => {
  type Fn = (...a: number[]) => number;
  const ns = (granted: readonly Capability[], sink: Partial<CallSink> = {}): { fns: Record<string, Fn>; memory: WebAssembly.Memory; replies: ReplyTable } => {
    const memory: WebAssembly.Memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
    // TTL far beyond the test: these cases are about the ABI codes, not expiry (reply-table.test.ts).
    const replies: ReplyTable = new ReplyTable(2, 60_000, new ManualClock().now);
    const full: CallSink = { call: () => ({ now: encodeCbor({ ok: 1 }) }), replies, replyReady: () => {}, gate: () => null, ...sink };
    const imports: WebAssembly.Imports = buildImports(new Set<Capability>(granted), memory, full);
    return { fns: imports[ABI_NAMESPACE] as unknown as Record<string, Fn>, memory, replies };
  };

  it('has every group, the memory and the readers, and nothing else', () => {
    const { fns } = ns([]);
    expect(Object.keys(fns).sort()).toEqual([...ABI_GROUPS, 'memory', 'reply_len', 'reply_read'].sort());
  });

  it('every ungranted group answers ungranted and never calls the dispatcher', () => {
    let dispatched: number = 0;
    const { fns, memory } = ns([], { call: () => { dispatched++; return { now: encodeCbor({ ok: 1 }) }; } });
    const ungranted: AbiGroup[] = ABI_GROUPS.filter((g: AbiGroup) => !['canvas', 'ui', 'events', 'navigate', 'log'].includes(g));
    for (const g of ungranted) {
      const n: number = fns.reply_read(fns[g](1, 0, 0), 0, 64);
      expect(n).toBeGreaterThan(0);
      const d: Decoded = decodeCbor(new Uint8Array(memory.buffer, 0, n).slice());
      expect(d.ok && d.value).toEqual({ refused: 'ungranted' });
    }
    expect(dispatched).toBe(0);
  });

  it('pointers outside memory, unknown handles, small buffers and exhausted handles are ABI errors', () => {
    const { fns } = ns(['nodes.read']);
    expect(fns.nodes(1, 65_530, 100)).toBe(ABI_ERROR.BAD_REQUEST);
    expect(fns.nodes(1, -1, 4)).toBe(ABI_ERROR.BAD_REQUEST);
    expect(fns.reply_read(12345, 0, 64)).toBe(ABI_ERROR.UNKNOWN_HANDLE);
    const h: number = fns.nodes(1, 0, 0);
    expect(fns.reply_read(h, 0, 1)).toBe(ABI_ERROR.BUFFER_TOO_SMALL);
    expect(fns.reply_read(h, 65_535, 64)).toBe(ABI_ERROR.BAD_REQUEST);
    fns.nodes(1, 0, 0);
    expect(fns.nodes(1, 0, 0)).toBe(ABI_ERROR.HANDLES_EXHAUSTED);
    expect(fns.reply_read(h, 0, 64)).toBeGreaterThan(0);
    expect(fns.reply_read(h, 0, 64)).toBe(ABI_ERROR.UNKNOWN_HANDLE);
  });

  it('a sink that throws becomes badRequest, never an exception in the guest', () => {
    const { fns } = ns(['nodes.read'], { call: () => { throw new Error('boom'); } });
    expect(fns.nodes(1, 0, 0)).toBe(ABI_ERROR.BAD_REQUEST);
  });
});
