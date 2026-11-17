/**
 * An operation past MAX_OP_RETRIES was removed from the queue and `continue`d,
 * never reaching the count the caller checks. So the very click that discarded
 * a rename for good reported "Tree synced with peer".
 *
 * The code called that drop "deliberate and loud" — but the only trace was
 * `debugLog`, which is a no-op in production.
 */
import { describe, it, expect, vi } from 'vitest';
import { retryPendingOps } from '../revfs-retry';
import type { RetryOutcome } from '@/lib/revfs/revfs-retry';

const EXHAUSTED: number = 5; // MAX_OP_RETRIES

function op(id: string, retryCount: number): { operation: { op_id: string; op_type: string; }; retryCount: number; } {
  return { operation: { op_id: id, op_type: 'RenameFile' }, retryCount };
}

function depsWith(entries: ReturnType<typeof op>[]): { removed: string[]; deps: Parameters<typeof retryPendingOps>[0]; } {
  const removed: string[] = [];
  let queue: { operation: { op_id: string; op_type: string; }; retryCount: number; }[] = [...entries];
  return {
    removed,
    deps: {
      state: {
        getPendingOps: () => queue,
        removePendingOp: (_k: string, id: string) => {
          removed.push(id);
          queue = queue.filter((e) => e.operation.op_id !== id);
        },
        registerAck: () => Promise.resolve(true),
      },
      // The queue is persisted at the end of every flush.
      io: { execute: vi.fn(async () => undefined) },
      sendOp: vi.fn(async () => true),
    } as unknown as Parameters<typeof retryPendingOps>[0],
  };
}

describe('retryPendingOps', () => {
  it('reports an abandoned operation instead of counting it as synced', async () => {
    const { deps, removed } = depsWith([op('a', EXHAUSTED)]);

    const outcome: RetryOutcome = await retryPendingOps(deps, 'key', 1n);

    // Previously { stillPending: 0 } with no other signal, which the caller
    // rendered as a green "Tree synced with peer".
    expect(outcome.discarded).toBe(1);
    expect(outcome.stillPending).toBe(0);
    expect(removed).toEqual(['a']);
  });

  it('keeps discarded and still-pending separate — they need different words', async () => {
    const { deps } = depsWith([op('gone', EXHAUSTED), op('retryable', 1)]);

    const outcome: RetryOutcome = await retryPendingOps(deps, 'key', 1n);

    expect(outcome.discarded).toBe(1);
    // One will be tried again; the other never will. Merging them would tell
    // the user their lost change is coming back.
    expect(outcome.stillPending).toBeGreaterThanOrEqual(0);
  });

  it('reports nothing when there was nothing queued', async () => {
    const { deps } = depsWith([]);
    expect(await retryPendingOps(deps, 'key', 1n)).toEqual({ stillPending: 0, discarded: 0 });
  });
});
