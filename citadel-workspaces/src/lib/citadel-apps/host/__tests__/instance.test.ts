/**
 * An instance end to end with the production worker host (in-process, real MessageChannel): it
 * loads, fails init, traps when memory growth passes the maximum, gets fresh zeroed memory,
 * reaches a granted port through the main thread's re-check and gets its reply as a reply_ready
 * event, logs to the page, and is capped per page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppEvent } from '../../sdk/generated/AppEvent';
import { encodeCbor } from '../cbor';
import type { Capability } from '../capabilities';
import { inspectArtifact, type LoadVerdict } from '../inspect';
import { AppInstance, launchAppInstance, type Launch, type LaunchOptions } from '../instance';
import { InstanceSlots } from '../instance-slots';
import { STANDARD_HOST_POLICY } from '../limits';
import type { HostPorts } from '../ports';
import { appModule, FIXTURE_CLOSE_GRACE_MS, fixtureContext, growOrTrap, importIndex, type AppModuleOptions } from './app-fixtures';
import { fakeLog, fakeStorage, fakeUi, type Recorder } from './fakes';
import { inProcess, realClock, until, type InProcess } from './in-process';
import { op } from './wasm-builder';

let rigs: InProcess[] = [];
afterEach(() => {
  rigs.forEach((r: InProcess) => r.close());
  rigs = [];
});

interface Opts { granted?: Capability[]; declared?: Capability[]; ports?: HostPorts; slots?: InstanceSlots; maxPages?: number }

async function launch(bytes: Uint8Array, opts: Opts = {}): Promise<{ launch: Launch; rig: InProcess }> {
  const granted: ReadonlySet<Capability> = new Set<Capability>(opts.granted ?? []);
  const declared: ReadonlySet<Capability> = new Set<Capability>(opts.declared ?? opts.granted ?? []);
  const verdict: LoadVerdict = await inspectArtifact(bytes, declared, opts.maxPages ?? 16);
  if (!verdict.ok) throw new Error(`fixture refused: ${verdict.reasons.join(', ')}`);
  const rig: InProcess = inProcess();
  rigs.push(rig);
  const options: LaunchOptions = {
    appId: 'com.acme.test', module: verdict.module, granted, context: fixtureContext([...granted], FIXTURE_CLOSE_GRACE_MS), closeGraceMs: FIXTURE_CLOSE_GRACE_MS, pageUrl: 'https://work.avarok.net/workspace',
    memory: { initialPages: verdict.memory.minPages, maxPages: opts.maxPages ?? 16 }, policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null },
    ports: opts.ports ?? {}, clock: realClock, slots: opts.slots ?? new InstanceSlots(8), spawn: rig.spawn,
  };
  return { launch: launchAppInstance(options), rig };
}

const running = (l: Launch): AppInstance => {
  if (!l.ok) throw new Error('not launched');
  return l.instance;
};
const action = (id: string): AppEvent => ({ ui_action: { id } });

describe('lifecycle', () => {
  it('the clean module loads and runs', async () => {
    const i: AppInstance = running((await launch(appModule())).launch);
    await until(() => i.state === 'running', 2000);
    expect(i.initStatus).toBe(0);
  });

  it('app_init returning non-zero is init-failed, and the worker is terminated', async () => {
    const { launch: l, rig } = await launch(appModule({ init: op.i32(7) }));
    const i: AppInstance = running(l);
    await until(() => i.state === 'init-failed', 2000);
    expect(i.initStatus).toBe(7);
    expect(rig.terminated()).toBe(1);
  });
});

describe('memory', () => {
  const grower = (pages: number): Uint8Array => appModule({ memory: { min: 1, max: 64 }, event: growOrTrap(pages) });

  it('growing past the host maximum traps the instance (control: growing within it keeps running)', async () => {
    const within: AppInstance = running((await launch(grower(1), { maxPages: 2 })).launch);
    await until(() => within.state === 'running', 2000);
    within.postEvent(action('grow'));
    const past: AppInstance = running((await launch(grower(2), { maxPages: 2 })).launch);
    await until(() => past.state === 'running', 2000);
    past.postEvent(action('grow'));
    await until(() => past.state === 'stopped-trapped', 2000);
    expect(past.trapMessage).toMatch(/unreachable/);
    expect(past.trapMemoryPages).toBe(1);
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(within.state).toBe('running');
  });

  it('each instance gets fresh zeroed memory (control: the same instance reads back what it wrote)', async () => {
    const MARK: number = 40_000;
    // init: status = mem[MARK]; mem[MARK] = 0x55; return status. event: init's status again, via a second init-like read.
    const init: number[] = [...op.i32(MARK), 0x28, 0x02, 0x00, ...op.i32(MARK), ...op.i32(0x55), ...op.store];
    const first: AppInstance = running((await launch(appModule({ init }))).launch);
    await until(() => first.state !== 'loading', 2000);
    expect(first.initStatus).toBe(0);
    const second: AppInstance = running((await launch(appModule({ init }))).launch);
    await until(() => second.state !== 'loading', 2000);
    expect(second.initStatus).toBe(0);
    const twice: number[] = [...op.i32(MARK), ...op.i32(0x55), ...op.store, ...op.i32(MARK), 0x28, 0x02, 0x00];
    const control: AppInstance = running((await launch(appModule({ init: twice }))).launch);
    await until(() => control.state !== 'loading', 2000);
    expect(control.initStatus).toBe(0x55);
  });
});

const KV_AT: number = 1024;
const TOAST_AT: number = 2048;
const kvGet: Uint8Array = encodeCbor({ backend: 'user', key: 'k' });
const toast: Uint8Array = encodeCbor({ text: 'got it' });

/** event: the first time, storage KvGet; the next (its reply_ready), ui ShowToast; then nothing. */
function forwarder(): Uint8Array {
  const base: AppModuleOptions = { groups: ['storage', 'ui'] };
  const call = (group: 'storage' | 'ui', n: number, at: number, len: number): number[] =>
    [...op.i32(n), ...op.i32(at), ...op.i32(len), ...op.call(importIndex(base, group)), ...op.drop];
  const state: number[] = [...op.i32(16), 0x28, 0x02, 0x00];
  const setState = (n: number): number[] => [...op.i32(16), ...op.i32(n), ...op.store];
  const event: number[] = [
    ...state, 0x45, 0x04, 0x40, ...setState(1), ...call('storage', 1, KV_AT, kvGet.byteLength),
    0x05, ...state, ...op.i32(1), 0x46, 0x04, 0x40, ...setState(2), ...call('ui', 4, TOAST_AT, toast.byteLength), 0x0b, 0x0b,
  ];
  return appModule({ ...base, event, data: [{ offset: KV_AT, bytes: kvGet }, { offset: TOAST_AT, bytes: toast }] });
}

describe('ports through the worker boundary', () => {
  it('a granted call reaches the fake port and its reply arrives as a reply_ready event', async () => {
    const rec: Recorder = { calls: [] };
    const ports: HostPorts = { storage: fakeStorage(rec), ui: fakeUi(rec) };
    const i: AppInstance = running((await launch(forwarder(), { granted: ['storage.user'], ports })).launch);
    await until(() => i.state === 'running', 2000);
    i.postEvent(action('go'));
    await until(() => rec.calls.length === 2, 2000);
    expect(rec.calls).toEqual([{ method: 'KvGet', args: { backend: 'user', key: 'k' } }, { method: 'ShowToast', args: { text: 'got it' } }]);
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(rec.calls.length).toBe(2);
  });

  it('control: declared but not granted, the storage port is never reached and no reply_ready follows', async () => {
    const rec: Recorder = { calls: [] };
    const ports: HostPorts = { storage: fakeStorage(rec), ui: fakeUi(rec) };
    const i: AppInstance = running((await launch(forwarder(), { granted: [], declared: ['storage.user'], ports })).launch);
    await until(() => i.state === 'running', 2000);
    i.postEvent(action('go'));
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(rec.calls).toEqual([]);
  });

  it('log answers in the worker and reaches the page LogPort', async () => {
    const base: AppModuleOptions = { groups: ['log'] };
    const line: Uint8Array = encodeCbor({ level: 'info', message: 'hello' });
    const init: number[] = [...op.i32(1), ...op.i32(KV_AT), ...op.i32(line.byteLength), ...op.call(importIndex(base, 'log')), ...op.drop, ...op.i32(0)];
    const rec: Recorder = { calls: [] };
    const i: AppInstance = running((await launch(appModule({ ...base, init, data: [{ offset: KV_AT, bytes: line }] }), { ports: { log: fakeLog(rec) } })).launch);
    await until(() => rec.calls.length === 1, 2000);
    expect(rec.calls).toEqual([{ method: 'LogWrite', args: { level: 'info', message: 'hello' } }]);
    expect(i.state).toBe('running');
  });
});

describe('the per-page instance cap', () => {
  it('admits 8 and refuses the 9th until one is terminated', async () => {
    const slots: InstanceSlots = new InstanceSlots(STANDARD_HOST_POLICY.maxLiveInstancesPerPage);
    const live: AppInstance[] = [];
    for (let n: number = 0; n < 8; n++) live.push(running((await launch(appModule(), { slots })).launch));
    expect((await launch(appModule(), { slots })).launch).toEqual({ ok: false, reason: 'instance_limit' });
    live[0].terminate();
    expect((await launch(appModule(), { slots })).launch.ok).toBe(true);
  });
});
