/**
 * The leader election's timer may fire while a test's `instanceManager` double is
 * installed; it must find the members it calls. A bare `{ cid }` stub made the
 * timer throw "setLeader is not a function" as an unhandled error, but only when
 * CI was slow enough for the timer to fire before the file finished.
 * Fake timers make the election's wait elapse on demand.
 */
import { describe, it, expect, vi } from 'vitest';

vi.useFakeTimers();
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 42n }) };
});

describe('an instanceManager double', () => {
  it('survives the election timer firing', async () => {
    await import('@/lib/multi-instance/instance-channel');
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    vi.useRealTimers();
  });
});
