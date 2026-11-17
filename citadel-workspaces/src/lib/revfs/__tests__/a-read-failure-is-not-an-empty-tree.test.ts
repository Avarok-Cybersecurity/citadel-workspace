/**
 * A tree that could not be READ is not an empty tree.
 *
 * `OpfsStorage.readFile` caught every error and returned null, so a revoked
 * handle, a quota error, a locked file or any transient `NotReadableError` was
 * indistinguishable from a first run. `loadTree` returned null, and
 * `RevfsService.getTree` then built a default tree, cached it and PERSISTED it
 * -- over a tree that was still on disk. One transient read error destroyed the
 * user's files, silently, and the UI repainted as if they had never existed.
 *
 * Storage now reports the two cases apart. These tests pin both: the absent
 * case must still seed and persist a default (or nobody can ever start), and
 * the unreadable case must persist nothing.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import { createTestService } from './revfs-service-test-helpers';

const ALICE: bigint = 1n;
const BOB: bigint = 2n;

/** An IO stub whose load-tree answer is whatever the test says it is. */
function ioReturning(loadResult: RevfsIntentResult): {
  execute: Mock<(intent: RevfsIntent) => RevfsIntentResult>;
  persisted: RevfsIntent[];
} {
  const persisted: RevfsIntent[] = [];
  // Synchronous: `IntentHandler` is `(intent) => RevfsIntentResult`, not a
  // promise-returning one. vitest awaits either, so an async mock ran fine and
  // only `tsc` caught it.
  const execute = vi.fn<(intent: RevfsIntent) => RevfsIntentResult>((intent: RevfsIntent): RevfsIntentResult => {
    if (intent.type === 'load-tree') return loadResult;
    persisted.push(intent);
    if (intent.type === 'persist-tree') return { type: 'persist-tree', success: true };
    if (intent.type === 'load-pending-ops') return { type: 'load-pending-ops', ops: [] };
    return { type: 'persist-pending-ops', success: true };
  });
  return { execute, persisted };
}

describe('a read failure is not an empty tree', () => {
  it('does not persist a default over a tree it could not read', async () => {
    const io: ReturnType<typeof ioReturning> = ioReturning({ type: 'load-tree', tree: null, unreadable: true });
    const service: ReturnType<typeof createTestService> = createTestService(io.execute);

    // An error, not an empty default to render: the empty screen is what a
    // user reads as "my files are gone". See tree-load.ts.
    await expect(service.getTree(ALICE, BOB)).rejects.toThrow(/could not read/);

    expect(
      io.persisted.filter((i) => i.type === 'persist-tree'),
      'a default tree was written over storage that merely failed to answer',
    ).toHaveLength(0);
  });

  it('still seeds and persists a default when the tree is genuinely absent', async () => {
    // The control. Without it the fix could simply stop persisting ever, and
    // no assertion about the failure case would notice.
    const io: ReturnType<typeof ioReturning> = ioReturning({ type: 'load-tree', tree: null });
    const service: ReturnType<typeof createTestService> = createTestService(io.execute);

    await service.getTree(BOB, ALICE);

    expect(
      io.persisted.filter((i) => i.type === 'persist-tree'),
      'a first run must still get a default tree written',
    ).toHaveLength(1);
  });

  it('retries the load rather than caching the unreadable result', async () => {
    // Not caching is what makes this recoverable: a transient failure must not
    // pin an empty tree in memory for the rest of the session.
    const io: ReturnType<typeof ioReturning> = ioReturning({ type: 'load-tree', tree: null, unreadable: true });
    const service: ReturnType<typeof createTestService> = createTestService(io.execute);

    await expect(service.getTree(ALICE, BOB)).rejects.toThrow();
    await expect(service.getTree(ALICE, BOB)).rejects.toThrow();

    const loads: [RevfsIntent][] = io.execute.mock.calls.filter(
      ([intent]): boolean => (intent as RevfsIntent).type === 'load-tree',
    );
    expect(loads.length, 'the second call served a cached empty tree').toBe(2);
  });
});
