/**
 * A retry queue that could not be written to disk must say so.
 *
 * `persistTree` already had this: `RevfsIO.execute` never rejects — a full
 * disk, a revoked OPFS handle or a serialisation error all resolve as
 * `{ success: false }` — so it reads the result and raises
 * `revfs:persist-failed`, which `PersistFailureNotice` renders. That fix was
 * applied to one of the two places it belongs.
 *
 * The other is the pending-op queue, which holds operations a peer has not yet
 * acknowledged. All four `persist-pending-ops` calls in revfs-retry.ts
 * discarded the result, so a failed write was invisible: the user made edits,
 * the app queued them for retry, the queue did not reach disk, nothing was
 * shown, and the operations were gone after the next reload. The notice
 * component was already built and already listening; it just never heard about
 * this half.
 *
 * The gate that should have caught it could not. Its receiver pattern was
 * `\w+`, which matches `io.execute(` but not `deps.io.execute(` — and those
 * four are the only unassigned `execute({` calls in the tree, so the gate
 * evaluated zero sites and reported success on every run.
 *
 * Both directions are asserted. Without the success case, a helper hard-wired
 * to emit unconditionally would satisfy the failure case and would put a
 * "changes may not survive a reload" notice in front of every user on every
 * successful write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { sendAndAwaitAck } from '../revfs-retry';
import {
  persistPendingOps,
  markPendingOpsRead,
  resetPendingOpsReadTracking,
} from '../persist-pending-ops';
import type { RevfsOperation } from '@/types/revfs-types';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsIO } from '../revfs-io';

const OP: RevfsOperation = {
  op_id: 'op-1', op_type: 'Rmdir', path: '/x', timestamp: 1,
} as unknown as RevfsOperation;

/**
 * An io whose every intent resolves with the given success flag.
 *
 * `load-pending-ops` answers with an `ops` array rather than a bare success
 * flag, because that is the shape the real intent returns — and
 * `sendAndAwaitAck` now restores before it writes, so a load that answers
 * nothing leaves the queue unread and the write is refused. A mock that
 * answers the wrong shape would make these tests pass for the wrong reason.
 */
function io(success: boolean): RevfsIO {
  return {
    execute: async (intent: { type: string }): Promise<unknown> =>
      intent.type === 'load-pending-ops'
        ? { type: 'load-pending-ops', ops: [] }
        : { type: intent.type, success },
  } as unknown as RevfsIO;
}

function deps(persistSucceeds: boolean, sent: boolean): Parameters<typeof sendAndAwaitAck>[0] {
  return {
    state: {
      registerAck: (): Promise<boolean> => Promise.resolve(true),
      cancelAck: (): void => {},
      addPendingOp: (): void => {},
      getPendingOps: (): unknown[] => [],
    },
    io: io(persistSucceeds),
    sendOp: async (): Promise<boolean> => sent,
  } as unknown as Parameters<typeof sendAndAwaitAck>[0];
}

describe('a pending-op write that failed', () => {
  let failures: Array<{ treeKey: string }>;
  const onFailed = (payload: { treeKey: string }): void => { failures.push(payload); };

  beforeEach(() => {
    resetPendingOpsReadTracking();
    failures = [];
    eventEmitter.on('revfs:persist-failed', onFailed);
    // The helper logs the loss on the error channel, which is the only channel
    // that survives a production build. Silenced so the run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    eventEmitter.off('revfs:persist-failed', onFailed);
    vi.restoreAllMocks();
  });

  it('raises revfs:persist-failed directly', async () => {
    // Read first, as every production caller now does: the helper refuses to
    // write a queue for a key it has never read, because an unread queue is
    // empty for reasons that have nothing to do with what is stored.
    markPendingOpsRead('tree-1' as never);
    await persistPendingOps(io(false), 'tree-1' as never, []);
    expect(failures).toEqual([{ treeKey: 'tree-1' }]);
  });

  it('writes nothing at all for a key it has never read', async () => {
    // The guard itself. Without this the two tests either side of it pass
    // whether or not the write was attempted.
    const attempted: string[] = [];
    const recordingIo: RevfsIO = {
      execute: async (intent: { type: string }): Promise<unknown> => {
        attempted.push(intent.type);
        return { type: intent.type, success: true };
      },
    } as unknown as RevfsIO;

    await persistPendingOps(recordingIo, 'never-read' as never, []);

    expect(attempted, 'an unread key must not be written').toEqual([]);
    expect(failures, 'refusing is not a persist FAILURE, it is a refusal').toEqual([]);
  });

  it('says nothing when the write succeeded', async () => {
    // The control. A helper that emits unconditionally passes the test above
    // and shows a data-loss warning on every successful write.
    markPendingOpsRead('tree-1' as never);
    await persistPendingOps(io(true), 'tree-1' as never, []);
    expect(failures).toEqual([]);
  });

  it('reaches the notice from the send path, where the queue is actually written', async () => {
    // The call site, not just the helper. A helper nothing routes through is
    // the same defect one indirection further along.
    const acked: boolean = await sendAndAwaitAck(deps(false, false), 9n, OP, 'send-key' as never);

    expect(acked).toBe(false);
    expect(failures).toEqual([{ treeKey: 'send-key' }]);
  });

  it('says nothing from the send path when the queue was written', async () => {
    // Asserts the write HAPPENED as well as that nothing complained. Without
    // the first assertion this passes when the write is refused outright,
    // which is the same green for the opposite reason.
    const seen: string[] = [];
    const recording: Parameters<typeof sendAndAwaitAck>[0] = deps(true, false);
    const inner: RevfsIO['execute'] = recording.io.execute;
    recording.io.execute = async (intent: RevfsIntent): Promise<RevfsIntentResult> => {
      seen.push(intent.type);
      return inner(intent);
    };

    await sendAndAwaitAck(recording, 9n, OP, 'send-key' as never);

    expect(seen, 'the queue must actually have been written').toContain('persist-pending-ops');
    expect(failures).toEqual([]);
  });
});
