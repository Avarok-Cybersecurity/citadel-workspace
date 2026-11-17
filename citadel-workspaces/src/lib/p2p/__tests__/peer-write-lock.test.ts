import { describe, it, expect } from 'vitest';
import { withPeerLock } from '../peer-write-lock';

/**
 * The lock exists because the conversation store read-modify-writes IndexedDB
 * across several awaits. Two of those overlapping for one peer meant the second
 * save overwrote the first, and a received message disappeared after being
 * delivered, acknowledged and cached.
 *
 * These assert the property that prevents that — no interleaving per peer —
 * rather than the implementation, so the chain can be rewritten freely.
 */
const tick = (ms = 0): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

describe('withPeerLock', () => {
  it('does not interleave operations for the same peer', async () => {
    const events: string[] = [];
    const operation = (name: string, delay: number): Promise<void> =>
      withPeerLock(1n, async () => {
        events.push(`${name}:start`);
        await tick(delay);
        events.push(`${name}:end`);
      });

    // The first is deliberately the slower one: without the lock its `end`
    // would land after the second's `start`, which is the overlap that loses a
    // write.
    await Promise.all([operation('a', 20), operation('b', 0)]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('reads the shared value each operation actually wrote, not a stale copy', async () => {
    // A direct model of the bug: load, await, mutate, save. Unserialised, both
    // read 0 and the total ends at 1 instead of 2.
    let stored: number = 0;
    const increment = (): Promise<void> =>
      withPeerLock(7n, async () => {
        const seen: number = stored;
        await tick(5);
        stored = seen + 1;
      });

    await Promise.all([increment(), increment()]);

    expect(stored).toBe(2);
  });

  it('lets different peers proceed concurrently', async () => {
    const events: string[] = [];
    const slow: Promise<void> = withPeerLock(1n, async () => {
      events.push('slow:start');
      await tick(20);
      events.push('slow:end');
    });
    const fast: Promise<void> = withPeerLock(2n, async () => {
      events.push('fast:start');
      events.push('fast:end');
    });

    await Promise.all([slow, fast]);

    // The fast peer finishes while the slow one is still waiting: per-peer
    // serialisation must not become a global queue.
    expect(events).toEqual(['slow:start', 'fast:start', 'fast:end', 'slow:end']);
  });

  it('keeps running queued work after one operation rejects', async () => {
    const failing: Promise<never> = withPeerLock(9n, async (): Promise<never> => {
      throw new Error('write failed');
    });
    await expect(failing).rejects.toThrow('write failed');

    // A rejected predecessor must not poison the chain, or one failed write
    // would silently stop every later one for that peer.
    await expect(withPeerLock(9n, async () => 'ok')).resolves.toBe('ok');
  });
});
