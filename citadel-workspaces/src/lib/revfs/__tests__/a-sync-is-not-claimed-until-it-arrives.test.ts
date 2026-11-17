/**
 * "Tree synced with peer" is a claim about an answer.
 *
 * `requestSync` resolved as soon as the REQUEST was on the wire, and the file
 * manager then toasted success. Run 33304689050 shows how often the answer does
 * not come: a hundred redelivered sync requests crowding the reliable channel,
 * and the operations behind them never arriving. The user was told their view
 * was fresh while it was not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { awaitTreeChange } from '../await-tree-change';
import type { RevfsState } from '../revfs-state';
import type { TreeKey } from '@/types/revfs-types';

const KEY: TreeKey = 'a_b' as TreeKey;

function stateWith(): { state: RevfsState; fire: (key: TreeKey) => void; listeners: number } {
  const callbacks: Array<(key: TreeKey) => void> = [];
  const state: RevfsState = {
    onTreeChanged: (cb: (key: TreeKey) => void): (() => void) => {
      callbacks.push(cb);
      return (): void => { callbacks.splice(callbacks.indexOf(cb), 1); };
    },
  } as unknown as RevfsState;
  return {
    state,
    fire: (key: TreeKey): void => { [...callbacks].forEach((cb) => cb(key)); },
    get listeners(): number { return callbacks.length; },
  };
}

describe('waiting for a peer to answer a sync', () => {
  beforeEach((): void => { vi.useFakeTimers(); });
  afterEach((): void => { vi.useRealTimers(); });

  it('is true when the tree for that pair changes', async (): Promise<void> => {
    const h: ReturnType<typeof stateWith> = stateWith();
    const pending: Promise<boolean> = awaitTreeChange(h.state, KEY, 1_000);
    h.fire(KEY);
    await expect(pending).resolves.toBe(true);
  });

  it('is false when nothing arrives in time', async (): Promise<void> => {
    const h: ReturnType<typeof stateWith> = stateWith();
    const pending: Promise<boolean> = awaitTreeChange(h.state, KEY, 1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(pending).resolves.toBe(false);
  });

  it('ignores another pair’s tree', async (): Promise<void> => {
    // Positive control: resolving on ANY change would report a sync with the
    // wrong peer as this peer answering.
    const h: ReturnType<typeof stateWith> = stateWith();
    const pending: Promise<boolean> = awaitTreeChange(h.state, KEY, 1_000);
    h.fire('c_d' as TreeKey);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(pending).resolves.toBe(false);
  });

  it('unsubscribes either way, so a sync button is not a leak', async (): Promise<void> => {
    const h: ReturnType<typeof stateWith> = stateWith();
    const answered: Promise<boolean> = awaitTreeChange(h.state, KEY, 1_000);
    h.fire(KEY);
    await answered;
    expect(h.listeners).toBe(0);

    const timedOut: Promise<boolean> = awaitTreeChange(h.state, KEY, 1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    await timedOut;
    expect(h.listeners).toBe(0);
  });
});
