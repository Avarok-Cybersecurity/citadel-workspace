/**
 * Operations queued for an unreachable peer died on reload.
 *
 * Every failure path in `revfs-retry.ts` persists the queue —
 * `{type: 'persist-pending-ops'}` — and `RevfsIO` implements the matching
 * `load-pending-ops` intent. Nothing ever dispatches it. `setPendingOps`, the
 * only API that could repopulate the in-memory map, has zero production callers.
 *
 * So: Alice renames or deletes a file while Bob is unreachable, the op is queued
 * and written to `pending_ops.json`, and she reloads. The in-memory queue starts
 * empty, `retryPendingOps` returns `{stillPending: 0, discarded: 0}` against it,
 * and the file manager reports "Tree synced with peer". The rename is never sent
 * — and for a deletion, Bob's next SyncResponse union-merges the file straight
 * back into her tree.
 *
 * A feature built from one end: the write half and the reader both exist, and
 * nothing connects them. `check-installers-are-called` cannot see it because
 * `RevfsIO.loadPendingOps` IS called — by the intent switch. It is the INTENT
 * that is never dispatched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryPendingOps } from '../revfs-retry';
import { RevfsState } from '../revfs-state';
import type { RevfsPendingOp, TreeKey } from '@/types/revfs-types';

const KEY: TreeKey = '111_222' as TreeKey;
const PEER: bigint = 222n;

function queuedOp(opId: string): RevfsPendingOp {
  return {
    operation: { op_id: opId, op_type: 'Rmdir', path: '/gone', timestamp: 1 },
    retryCount: 0,
  } as unknown as RevfsPendingOp;
}

function deps(persisted: RevfsPendingOp[]): {
  state: RevfsState;
  io: { execute: ReturnType<typeof vi.fn> };
  sendOp: ReturnType<typeof vi.fn>;
  sent: string[];
} {
  const sent: string[] = [];
  const io: { execute: ReturnType<typeof vi.fn> } = {
    execute: vi.fn(async (intent: { type: string }) => {
      if (intent.type === 'load-pending-ops') {
        return { type: 'load-pending-ops', ops: persisted };
      }
      return { type: intent.type, success: true };
    }),
  };
  const state: RevfsState = new RevfsState();
  // Acks as soon as it sends: the drain awaits a registered ack, and resolving
  // it from the test body raced the async queue restore that now runs first.
  const sendOp: ReturnType<typeof vi.fn> = vi.fn(async (_p: bigint, op: { op_id: string }) => {
    sent.push(op.op_id);
    state.resolveAck(op.op_id, true);
    return true;
  });
  return { state, io, sendOp, sent };
}

describe('a queue that outlived the page', () => {
  let d: ReturnType<typeof deps>;

  beforeEach((): void => { d = deps([queuedOp('op-1')]); });

  it('sends an op that was queued before the reload', async () => {
    // The in-memory queue is empty, exactly as it is on a fresh page.
    expect(d.state.getPendingOps(KEY)).toEqual([]);

    // Acknowledge whatever goes out, so the drain completes.
    await retryPendingOps(
      { state: d.state, io: d.io as never, sendOp: d.sendOp as never },
      KEY,
      PEER,
    );

    expect(d.sent).toEqual(['op-1']);
  });

  it('reports nothing to send when nothing was persisted either', async () => {
    // Negative control: a loader that invented work would pass the assertion
    // above. An empty store must still produce an empty drain.
    const empty: ReturnType<typeof deps> = deps([]);

    const outcome: { stillPending: number; discarded: number } = await retryPendingOps(
      { state: empty.state, io: empty.io as never, sendOp: empty.sendOp as never },
      KEY,
      PEER,
    );

    expect(outcome).toEqual({ stillPending: 0, discarded: 0 });
    expect(empty.sent).toEqual([]);
  });

  it('does not re-add an op the in-memory queue already has', async () => {
    // The load runs on every drain, not only the first, so a persisted op that
    // is already queued must not be queued twice and sent twice.
    d.state.addPendingOp(KEY, queuedOp('op-1'));

    await retryPendingOps(
      { state: d.state, io: d.io as never, sendOp: d.sendOp as never },
      KEY,
      PEER,
    );

    expect(d.sent).toEqual(['op-1']);
  });
});
