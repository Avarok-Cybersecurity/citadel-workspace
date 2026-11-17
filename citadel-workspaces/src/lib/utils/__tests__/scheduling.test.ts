import { describe, it, expect, vi    } from 'vitest';
import { yieldToEventLoop, waitFor, waitForEvent } from '../scheduling';

describe('yieldToEventLoop', () => {
  it('yields as a macrotask, so the browser gets a chance to paint', async () => {
    // The distinction this helper exists for: an awaited promise is a MICROtask
    // and runs before the browser renders, so a loop of them starves paint. A
    // macrotask lets rendering in. Ordering proves which one we got.
    const order: string[] = [];
    void Promise.resolve().then(() => order.push('microtask'));
    const macro: Promise<void> = new Promise<void>(r => setTimeout(() => { order.push('macrotask'); r(); }, 0));
    await yieldToEventLoop();
    await macro;
    expect(order).toEqual(['microtask', 'macrotask']);
  });

  it('schedules with no delay of its own', async () => {
    // Guards against the hardcoded 10ms per file-transfer chunk coming back.
    //
    // Asserts the DELAY ARGUMENT rather than elapsed wall-clock. Two earlier
    // versions of this test timed the call — first one yield against 10ms, then
    // twenty against 100ms — and both failed intermittently under full-suite
    // load, because scheduler jitter and a deliberate delay are the same
    // measurement. Nothing about the threshold could separate them; only the
    // argument can.
    const spy = vi.spyOn(globalThis, 'setTimeout');
    try {
      await yieldToEventLoop();

      expect(spy).toHaveBeenCalledTimes(1);
      const [, delay] = spy.mock.calls[0];
      expect(delay).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('waitFor', () => {
  it('returns immediately when the condition already holds', async () => {
    const start: number = Date.now();
    await expect(waitFor(() => true, { timeoutMs: 1000, description: 'always true' }))
      .resolves.toBe(true);
    // The whole point: a helper that always cost one poll interval would just be
    // a slower sleep.
    expect(Date.now() - start).toBeLessThan(20);
  });

  it('returns as soon as the condition flips, not when the timeout elapses', async () => {
    let ready: boolean = false;
    setTimeout(() => { ready = true; }, 30);
    const start: number = Date.now();
    await waitFor(() => ready, { timeoutMs: 5000, intervalMs: 5, description: 'ready flag' });
    const elapsed: number = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(500); // nowhere near the 5s ceiling
  });

  it('accepts an async condition', async () => {
    let calls: number = 0;
    await expect(
      waitFor(async () => ++calls >= 3, { timeoutMs: 1000, intervalMs: 1, description: 'third call' })
    ).resolves.toBe(true);
    expect(calls).toBe(3);
  });

  it('names what it was waiting for when it times out', async () => {
    // A silent continue-into-a-broken-state is exactly what the fixed sleeps did.
    await expect(
      waitFor(() => false, { timeoutMs: 20, intervalMs: 5, description: 'peer channel ready' })
    ).rejects.toThrow(/waiting for: peer channel ready/);
  });

  it('can report failure without throwing, for best-effort settling', async () => {
    await expect(
      waitFor(() => false, { timeoutMs: 20, intervalMs: 5, description: 'optional', resolveOnTimeout: true })
    ).resolves.toBe(false);
  });

  it('does not overshoot its own deadline while polling', async () => {
    const start: number = Date.now();
    await waitFor(() => false, {
      timeoutMs: 30,
      intervalMs: 100, // deliberately longer than the timeout
      description: 'never',
      resolveOnTimeout: true,
    });
    // The final sleep is clamped to the remaining budget, so a coarse interval
    // cannot stretch a 30ms wait into a 100ms one.
    expect(Date.now() - start).toBeLessThan(90);
  });
});

describe('waitForEvent', () => {
  it('resolves with the emitted value and unsubscribes', async () => {
    const unsubscribe: ReturnType<typeof vi.fn> = vi.fn();
    const promise: Promise<string> = waitForEvent<string>(resolve => {
      setTimeout(() => resolve('connected'), 10);
      return unsubscribe;
    }, { timeoutMs: 1000, description: 'peer connect' });

    await expect(promise).resolves.toBe('connected');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on timeout too, so a listener cannot leak', async () => {
    const unsubscribe: ReturnType<typeof vi.fn> = vi.fn();
    const promise: Promise<void> = waitForEvent(() => unsubscribe, { timeoutMs: 20, description: 'never fires' });

    await expect(promise).rejects.toThrow(/waiting for: never fires/);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores a second emission rather than settling twice', async () => {
    const unsubscribe: ReturnType<typeof vi.fn> = vi.fn();
    let emit!: (v: string) => void;
    const promise: Promise<string> = waitForEvent<string>(resolve => { emit = resolve; return unsubscribe; },
      { timeoutMs: 1000, description: 'double emit' });

    emit('first');
    emit('second');

    await expect(promise).resolves.toBe('first');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
