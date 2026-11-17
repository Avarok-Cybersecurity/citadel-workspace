/**
 * Read-modify-write, serialised per key.
 *
 * The shape: load a record, mutate it in memory, save it back, with awaits in
 * between. Two of those at once for the same key both read the same value, each
 * applies its own change to its own copy, and the second save discards the
 * first.
 *
 * It cost a received P2P message once — delivered, acknowledged, cached, then
 * written over — and the RE-VFS tree had the identical shape with no lock at
 * all: a bulk delete under `Promise.all` had every operation capture the same
 * base tree, so the last write resurrected everything the others removed.
 */

import { describe, it, expect, vi  } from 'vitest';
import { withSerialLock } from '../serial-queue';

/** A store with the exact hazard: a gap between reading and writing. */
function racyStore(initial: string[]): { read: () => string[]; write: (next: string[]) => Promise<void>; readonly current: string[]; } {
  let value: string[] = initial;
  return {
    read: (): string[] => value,
    write: async (next: string[]): Promise<void> => {
      await Promise.resolve();
      value = next;
    },
    get current(): string[] {
      return value;
    },
  };
}

describe('withSerialLock', () => {
  it('does not lose a concurrent write to the same key', async () => {
    const store: { read: () => string[]; write: (next: string[]) => Promise<void>; readonly current: string[]; } = racyStore(['a', 'b', 'c']);
    const remove = (item: string) => async (): Promise<void> => {
      const current: string[] = store.read();
      await Promise.resolve();
      await store.write(current.filter((x) => x !== item));
    };

    await Promise.all([
      withSerialLock('tree', remove('a')),
      withSerialLock('tree', remove('b')),
    ]);

    // Unserialised, the second read sees the pre-delete array and its write
    // resurrects whatever the first removed.
    expect(store.current).toEqual(['c']);
  });

  it('still runs different keys concurrently', async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number) => async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, ms));
      order.push(name);
    };

    await Promise.all([
      withSerialLock('one', slow('slow', 20)),
      withSerialLock('two', slow('fast', 1)),
    ]);

    // If unrelated keys queued behind each other, 'slow' would finish first.
    expect(order).toEqual(['fast', 'slow']);
  });

  it('does not cancel the operations queued behind a failure', async () => {
    // Note on what this does and does not discriminate, established by control:
    // the implementation has two `.catch`es, and removing EITHER alone leaves
    // this passing, because each is sufficient on its own for queue
    // continuation. Only removing both fails it. The second catch earns its
    // place for a different reason -- it stops a rejected promise sitting in
    // the map with nobody awaiting it, which is an unhandled rejection -- and
    // that is stated at the code rather than pretended to be tested here.
    const after: ReturnType<typeof vi.fn> = vi.fn();

    const failed: Promise<never> = withSerialLock('tree', (): Promise<never> => Promise.reject(new Error('nope')));
    const queued: Promise<void> = withSerialLock('tree', async () => { after(); });

    await expect(failed).rejects.toThrow('nope');
    await queued;
    expect(after).toHaveBeenCalled();
  });

  it('reports each operation\'s own outcome to its own caller', async () => {
    const first: Promise<string> = withSerialLock('tree', async () => 'first');
    const second: Promise<never> = withSerialLock('tree', (): Promise<never> => Promise.reject(new Error('second')));
    const third: Promise<string> = withSerialLock('tree', async () => 'third');

    await expect(first).resolves.toBe('first');
    await expect(second).rejects.toThrow('second');
    await expect(third).resolves.toBe('third');
  });
});
