/**
 * Importing multi-tab coordination schedules nothing; boot starts it.
 *
 * The channel used to open its BroadcastChannel and start the election's timers
 * in its constructor, which ran at import. Every test file that reached it
 * through websocket-service -- and every copy a vi.resetModules() made -- kept
 * announcing and heartbeating to the others after its last test, until a log
 * landed while the worker closed ("Closing rpc while onUserConsoleLog was
 * pending"). The cross-tab sync channel did the same. main.tsx now starts
 * both; stopping coordination ends every timer its start began.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const opened: { count: number } = vi.hoisted((): { count: number } => ({ count: 0 }));

beforeEach((): void => {
  vi.useFakeTimers();
  const Real: typeof BroadcastChannel = globalThis.BroadcastChannel;
  vi.stubGlobal('BroadcastChannel', class extends Real {
    constructor(name: string) { super(name); opened.count += 1; }
  });
});

afterEach((): void => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('multi-tab coordination', () => {
  it('schedules no timer and opens no channel when imported, even through websocket-service', async () => {
    await import('@/lib/multi-instance');
    await import('@/lib/websocket-service');
    // jsdom queues a storage event for every sessionStorage write; that one-shot is not ours.
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
    expect(opened.count).toBe(0);
  });

  it('starts at boot, and stopping ends every timer it started', async () => {
    const coordination: typeof import('@/lib/multi-instance') = await import('@/lib/multi-instance');

    const openedBefore: number = opened.count;
    coordination.startInstanceCoordination();
    expect(opened.count).toBe(openedBefore + 1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    coordination.stopInstanceCoordination();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
