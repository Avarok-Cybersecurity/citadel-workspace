import { describe, expect, it } from 'vitest';
import { ManualClock } from '@/lib/telemetry/console-capture/__tests__/fakes';
import { initialPhase, runAutoPhase, type AutoPhase } from '../auto-phase';
import type { Wake } from '../binding';
import { RETRY_DELAYS_MS } from '../retry-policy';
import type { RecoveryRoute } from '../route';

const wait: RecoveryRoute = { kind: 'wait', until: 'peer-online', deadlineMs: 10_000, then: { kind: 'retry' } };
const auto: RecoveryRoute = { kind: 'retry-auto', policy: 'short', then: { kind: 'retry' } };

/** A wake whose signal the test fires by hand. */
type ManualWake = { wake: Wake; fire: () => void; subscribed: () => number };

function manualWake(): ManualWake {
  const listeners: Set<() => void> = new Set<() => void>();
  return {
    wake: (resume: () => void): (() => void) => { listeners.add(resume); return (): void => { listeners.delete(resume); }; },
    fire: (): void => { for (const l of [...listeners]) l(); },
    subscribed: (): number => listeners.size,
  };
}

const flush = (): Promise<void> => new Promise<void>((done: () => void): void => { setTimeout(done, 0); });

describe('a wait', () => {
  it('ends resolved when its signal comes before the deadline, and stops listening', () => {
    const clock: ManualClock = new ManualClock();
    const signal: ManualWake = manualWake();
    const seen: AutoPhase[] = [];
    runAutoPhase(wait, { wake: signal.wake }, clock, (p: AutoPhase): void => { seen.push(p); });
    expect(signal.subscribed()).toBe(1);
    signal.fire();
    clock.advance(20_000);
    expect(seen).toEqual([{ kind: 'resolved' }]);
    expect(signal.subscribed()).toBe(0);
  });

  it('hands the person its fallback at the deadline, and never resolves after', () => {
    const clock: ManualClock = new ManualClock();
    const signal: ManualWake = manualWake();
    const seen: AutoPhase[] = [];
    expect(initialPhase(wait, clock)).toEqual({ kind: 'waiting', until: 'peer-online', deadlineAt: clock.now() + 10_000 });
    runAutoPhase(wait, { wake: signal.wake }, clock, (p: AutoPhase): void => { seen.push(p); });
    clock.advance(10_000);
    signal.fire();
    expect(seen).toEqual([{ kind: 'manual' }]);
  });

  it('cannot start without a signal to wake it', () => {
    expect((): void => { runAutoPhase(wait, {}, new ManualClock(), (): void => undefined); }).toThrow(/needs the binding's wake/);
  });
});

describe('an automatic retry', () => {
  it('stops at the first attempt that succeeds', async () => {
    const clock: ManualClock = new ManualClock();
    const seen: AutoPhase[] = [];
    let attempts: number = 0;
    runAutoPhase(auto, { retry: async (): Promise<void> => { attempts += 1; if (attempts < 2) throw new Error('not yet'); } }, clock, (p: AutoPhase): void => { seen.push(p); });
    clock.advance(RETRY_DELAYS_MS.short[0]);
    await flush();
    clock.advance(RETRY_DELAYS_MS.short[1]);
    await flush();
    expect(attempts).toBe(2);
    expect(seen.map((p: AutoPhase): string => p.kind)).toEqual(['retrying', 'resolved']);
  });

  it('gives the person its fallback when every attempt fails', async () => {
    const clock: ManualClock = new ManualClock();
    const seen: AutoPhase[] = [];
    runAutoPhase(auto, { retry: async (): Promise<void> => { throw new Error('down'); } }, clock, (p: AutoPhase): void => { seen.push(p); });
    for (const delay of RETRY_DELAYS_MS.short) { clock.advance(delay); await flush(); }
    expect(seen.at(-1)).toEqual({ kind: 'manual' });
    expect(seen.filter((p: AutoPhase): boolean => p.kind === 'retrying')).toHaveLength(RETRY_DELAYS_MS.short.length - 1);
  });
});
