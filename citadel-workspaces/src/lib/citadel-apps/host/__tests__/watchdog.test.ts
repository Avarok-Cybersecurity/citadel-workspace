/**
 * The handle's watchdog over a scripted channel and a manual clock: exactly when it fires, what
 * it measures from, and that answers in time keep an instance alive.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { launchAppInstance, type AppInstance, type Launch } from '../instance';
import { InstanceSlots } from '../instance-slots';
import { STANDARD_HOST_POLICY } from '../limits';
import { FIXTURE_CLOSE_GRACE_MS, fixtureContext } from './app-fixtures';
import { ManualClock } from './fakes';
import { scripted, seqOf, type Scripted } from './scripted-channel';

const BUDGET: number = STANDARD_HOST_POLICY.computeBudgetMs;

function launch(clock: ManualClock, s: Scripted, slots: InstanceSlots = new InstanceSlots(8)): AppInstance {
  const l: Launch = launchAppInstance({
    appId: 'a.b', module: {} as WebAssembly.Module, granted: new Set<Capability>(), memory: { initialPages: 1, maxPages: 1 },
    context: fixtureContext([], FIXTURE_CLOSE_GRACE_MS), closeGraceMs: FIXTURE_CLOSE_GRACE_MS, pageUrl: 'https://work.avarok.net/', policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, ports: {}, clock, slots, spawn: () => s.channel,
  });
  if (!l.ok) throw new Error('no slot');
  return l.instance;
}

/** The worker answers the load, then the start (AppEvent init), so frames are delivered. */
function loadedAndStarted(s: Scripted, i: AppInstance): void {
  s.reply({ kind: 'loaded', seq: seqOf(s.sent[0]), status: 0 });
  expect(i.start()).toBe(true);
  s.reply({ kind: 'done', seq: seqOf(s.sent[s.sent.length - 1]) });
}

describe('watchdog', () => {
  it('a load that never answers is stopped at the budget, not before', () => {
    const clock: ManualClock = new ManualClock();
    const s: Scripted = scripted();
    const slots: InstanceSlots = new InstanceSlots(8);
    const i: AppInstance = launch(clock, s, slots);
    clock.advance(BUDGET - 1);
    expect(i.state).toBe('loading');
    clock.advance(1);
    expect(i.state).toBe('stopped-unresponsive');
    expect(s.terminated).toBe(1);
    expect(slots.inUse).toBe(0);
  });

  it('control: answers within the budget keep it running indefinitely', () => {
    const clock: ManualClock = new ManualClock();
    const s: Scripted = scripted();
    const i: AppInstance = launch(clock, s);
    clock.advance(BUDGET - 1);
    loadedAndStarted(s, i);
    for (let n: number = 0; n < 10; n++) {
      i.frame(16);
      clock.advance(BUDGET - 1);
      s.reply({ kind: 'done', seq: seqOf(s.sent[s.sent.length - 1]) });
    }
    clock.advance(BUDGET * 10);
    expect(i.state).toBe('running');
    expect(s.terminated).toBe(0);
  });

  it('a queued message gets its own budget from when the one ahead of it finished', () => {
    const clock: ManualClock = new ManualClock();
    const s: Scripted = scripted();
    const i: AppInstance = launch(clock, s);
    loadedAndStarted(s, i);
    i.frame(16);
    i.frame(16);
    const [first, second] = s.sent.slice(-2).map(seqOf);
    clock.advance(BUDGET - 100);
    s.reply({ kind: 'done', seq: first });
    clock.advance(BUDGET - 1);
    expect(i.state).toBe('running');
    clock.advance(1);
    expect(i.state).toBe('stopped-unresponsive');
    expect(second).toBeGreaterThan(first);
  });

  it('worker-initiated guest runs (busy ... done) are timed too', () => {
    const clock: ManualClock = new ManualClock();
    const s: Scripted = scripted();
    const i: AppInstance = launch(clock, s);
    loadedAndStarted(s, i);
    s.reply({ kind: 'busy', seq: -1 });
    clock.advance(BUDGET);
    expect(i.state).toBe('stopped-unresponsive');
  });

  it('a trap stops the instance at once', () => {
    const clock: ManualClock = new ManualClock();
    const s: Scripted = scripted();
    const i: AppInstance = launch(clock, s);
    s.reply({ kind: 'trapped', seq: seqOf(s.sent[0]), message: 'RuntimeError: unreachable', memoryPages: 1 });
    expect(i.state).toBe('stopped-trapped');
    expect(s.terminated).toBe(1);
  });
});
