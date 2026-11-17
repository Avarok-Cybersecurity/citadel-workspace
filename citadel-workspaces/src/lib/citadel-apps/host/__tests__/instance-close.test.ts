/**
 * The handle's lifecycle and close over a scripted worker and a manual clock: which steps it
 * takes and refuses, what it sends for each, and every way a close ends -- settled, the grace
 * running out, a trap, before it started, after it stopped -- each exactly once, the worker
 * terminated and the slot released every time.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { launchAppInstance, type AppInstance, type CloseOutcome, type Launch } from '../instance';
import { InstanceSlots } from '../instance-slots';
import { STANDARD_HOST_POLICY } from '../limits';
import type { FromWorker, HostChannel, ToWorker } from '../worker-protocol';
import { fixtureContext } from './app-fixtures';
import { ManualClock } from './fakes';

/** Shorter than the compute budget, so a grace expiry here cannot be the watchdog firing. */
const GRACE: number = 300;

interface Rig { readonly i: AppInstance; readonly clock: ManualClock; readonly sent: ToWorker[]; readonly reply: (m: FromWorker) => void; readonly terminated: () => number; readonly slots: InstanceSlots }

function rig(): Rig {
  let listener: (e: MessageEvent<unknown>) => void = () => {};
  let terminated: number = 0;
  const sent: ToWorker[] = [];
  const channel: HostChannel = {
    postMessage: (m: ToWorker): void => { sent.push(m); },
    addEventListener: (_t: 'message', l: (e: MessageEvent<unknown>) => void): void => { listener = l; },
    terminate: (): void => { terminated++; },
  };
  const clock: ManualClock = new ManualClock();
  const slots: InstanceSlots = new InstanceSlots(1);
  const l: Launch = launchAppInstance({
    appId: 'a.b', module: {} as WebAssembly.Module, granted: new Set<Capability>(), memory: { initialPages: 1, maxPages: 1 },
    context: fixtureContext([], GRACE), closeGraceMs: GRACE, pageUrl: 'https://work.avarok.net/', policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, ports: {}, clock, slots, spawn: () => channel,
  });
  if (!l.ok) throw new Error('no slot');
  return { i: l.instance, clock, sent, reply: (m: FromWorker): void => listener({ data: m } as MessageEvent<unknown>), terminated: () => terminated, slots };
}

const seqOf = (m: ToWorker | undefined): number => (m !== undefined && 'seq' in m ? m.seq : -1);
const last = (r: Rig): ToWorker | undefined => r.sent[r.sent.length - 1];

function started(): Rig {
  const r: Rig = rig();
  r.reply({ kind: 'loaded', seq: seqOf(r.sent[0]), status: 0 });
  expect(r.i.start()).toBe(true);
  r.reply({ kind: 'done', seq: seqOf(last(r)) });
  return r;
}

const ended = (r: Rig): [string, number, number] => [r.i.state, r.terminated(), r.slots.inUse];

describe('the lifecycle the handle runs', () => {
  it('start, suspend and resume are steps; a step the machine does not list is refused and sends nothing', () => {
    const r: Rig = rig();
    expect([r.i.start(), r.i.lifecycle]).toEqual([false, 'created']);
    r.reply({ kind: 'loaded', seq: seqOf(r.sent[0]), status: 0 });
    expect(r.i.lifecycle).toBe('initialised');
    expect(r.i.resume()).toBe(false);
    expect(r.i.start()).toBe(true);
    expect(last(r)).toMatchObject({ kind: 'event', step: 'start' });
    const before: number = r.sent.length;
    expect([r.i.start(), r.i.resume()]).toEqual([false, false]);
    expect(r.sent.length).toBe(before);
    expect(r.i.suspend('hidden')).toBe(true);
    expect([last(r), r.i.lifecycle]).toMatchObject([{ kind: 'event', step: 'suspend' }, 'suspended']);
    expect(r.i.suspend('backgrounded')).toBe(false);
    // Suspended: no frames are sent, events and resizes still are (a suspended app is alive).
    const quiet: number = r.sent.length;
    r.i.frame(16);
    expect(r.sent.length).toBe(quiet);
    r.i.resize(100, 50, 2);
    expect(last(r)).toMatchObject({ kind: 'resize', width: 100, height: 50, dpr: 2 });
    expect(r.i.resume()).toBe(true);
    r.i.frame(16);
    expect(last(r)).toMatchObject({ kind: 'frame' });
  });
});

describe('closing an instance', () => {
  it('a settled close: app_close answered, then settled; closed, terminated, released, and every caller gets the one outcome', async () => {
    const r: Rig = started();
    const first: Promise<CloseOutcome> = r.i.close('uninstall');
    expect(last(r)).toEqual({ kind: 'close', reason: 'uninstall' });
    expect(r.i.close('unmount')).toBe(first);
    // Closing: no input, no frames, no lifecycle step is sent.
    const quiet: number = r.sent.length;
    r.i.postEvent({ ui_action: { id: 'x' } });
    r.i.frame(16);
    r.i.resize(1, 1, 1);
    expect([r.i.suspend('hidden'), r.sent.length]).toEqual([false, quiet]);
    r.reply({ kind: 'closing', result: 0 });
    expect(ended(r)).toEqual(['running', 0, 1]);
    r.reply({ kind: 'settled' });
    expect(await first).toMatchObject({ reason: 'uninstall', ending: 'settled', closeResult: 0 });
    expect([...ended(r), r.i.lifecycle]).toEqual(['closed', 1, 0, 'closed']);
  });

  it('the grace running out ends it whatever the app is doing, at the grace and not before', async () => {
    const r: Rig = started();
    const closing: Promise<CloseOutcome> = r.i.close('unmount');
    r.clock.advance(GRACE - 1);
    expect(ended(r)).toEqual(['running', 0, 1]);
    r.clock.advance(1);
    expect(await closing).toMatchObject({ ending: 'grace-expired', closeResult: null, ms: GRACE });
    expect(ended(r)).toEqual(['terminated', 1, 0]);
    // A late answer from the ended worker changes nothing.
    r.reply({ kind: 'settled' });
    expect(r.i.state).toBe('terminated');
  });

  it('a trap while closing ends it as trapped, and the grace no longer fires', async () => {
    const r: Rig = started();
    const closing: Promise<CloseOutcome> = r.i.close('host_shutdown');
    r.reply({ kind: 'trapped', seq: -1, message: 'RuntimeError: unreachable', memoryPages: 1 });
    expect(await closing).toMatchObject({ ending: 'trapped' });
    r.clock.advance(GRACE * 2);
    expect(ended(r)).toEqual(['stopped-trapped', 1, 0]);
  });

  it('before app_init answered there is nothing to close: it is ended as not started', async () => {
    const r: Rig = rig();
    expect(await r.i.close('unmount')).toMatchObject({ ending: 'not-started', closeResult: null });
    expect(ended(r)).toEqual(['terminated', 1, 0]);
    expect(r.sent.some((m: ToWorker) => m.kind === 'close')).toBe(false);
  });

  it('an instance that already stopped answers at once, and is not terminated twice', async () => {
    const r: Rig = started();
    r.i.terminate();
    expect(await r.i.close('unmount')).toMatchObject({ ending: 'already-stopped' });
    expect(ended(r)).toEqual(['terminated', 1, 0]);
  });
});
