/**
 * Re-sending RE-VFS operations that did not reach their peer.
 *
 * Extracted from revfs-service.ts to keep that module under the repo's 250-line
 * cap. The queue this drains used to have no drain at all — addPendingOp was
 * called on both failure paths, removePendingOp had zero callers anywhere in
 * production, and retryCount was written as 0 and never incremented. So an
 * operation that failed to send was recorded and then sat there forever while
 * the caller was told it had succeeded.
 */
import type { RevfsOperation, TreeKey, RevfsPendingOp } from '@/types/revfs-types';
import type { RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsState } from './revfs-state';
import type { RevfsIO } from './revfs-io';
import { debugLog } from '@/lib/debug-config';
import { persistPendingOps, markPendingOpsRead } from './persist-pending-ops';

const ACK_TIMEOUT_MS: number = 15_000;

export interface RetryDeps {
  state: RevfsState;
  io: RevfsIO;
  sendOp: (peerCid: bigint, operation: RevfsOperation) => Promise<boolean>;
}

/**
 * How many times a queued operation is re-sent before it is given up on.
 *
 * The queue used to have no drain at all: `addPendingOp` was called on both
 * failure paths, `removePendingOp` had zero callers anywhere in production, and
 * `retryCount` was written as 0 and never incremented. So an operation that
 * failed to send — or whose ack timed out — was recorded and then sat there
 * forever, while the caller was told the operation had succeeded. The local
 * tree showed the change and the peer never learned about it, with no error on
 * either side. The provider next door (yjs-p2p-provider/ack-checker.ts) had the
 * retry loop this needed the whole time.
 */
const MAX_OP_RETRIES: number = 5;

/**
 * Re-send everything queued for a peer. Called when a channel becomes usable
 * (drain-on-channel-ready.ts) and from the file manager's manual Sync. That
 * first caller existed only as this sentence for a while: nothing subscribed
 * to the channel event, so queued ops waited on a button press.
 *
 * Returns the number of operations still outstanding, so a caller can tell
 * "nothing to do" from "tried and still failing" — the distinction the
 * original silent queue made impossible.
 */
/**
 * What a flush actually did. `discarded` is separate from `stillPending`
 * because they need different words to the user: one will be retried, the other
 * is gone.
 */
export interface RetryOutcome {
  /** Operations still queued; these will be attempted again. */
  stillPending: number;
  /** Operations abandoned after MAX_OP_RETRIES. These will never be sent. */
  discarded: number;
}

/**
 * Bring back anything queued before this page existed.
 *
 * Every failure path here persists the queue, and `RevfsIO` implements the
 * matching `load-pending-ops` intent -- but nothing ever dispatched it, and
 * `setPendingOps` had no production caller at all. So an op queued for an
 * unreachable peer was written to `pending_ops.json` and then died on reload:
 * the in-memory queue started empty, the drain below found nothing, and the file
 * manager reported "Tree synced with peer" over a rename that was never sent.
 * For a deletion it was worse -- the peer's next SyncResponse union-merged the
 * file straight back.
 *
 * Merged by op_id rather than assigned, because this runs on every drain and not
 * only the first: an op still in memory must not be queued, and sent, twice.
 */
async function restorePersistedOps(deps: RetryDeps, key: TreeKey): Promise<void> {
  let result: RevfsIntentResult;
  try {
    result = await deps.io.execute({ type: 'load-pending-ops', treeKey: key });
  } catch (error) {
    // Nothing to merge and nothing lost: the queue is whatever is in memory,
    // which is what it was before. Throwing here would abort a drain that can
    // still deliver everything this session queued.
    debugLog('RevfsService', 'Could not read the persisted operation queue', error);
    return;
  }

  // An IO implementation that answers nothing must not abort the drain. This
  // crashed three existing tests whose mock returns undefined, and that was the
  // right complaint: losing the whole retry pass is worse than not restoring.
  if (!result || result.type !== 'load-pending-ops' || !Array.isArray(result.ops)) return;

  // The read reached the key and came back with an answer -- including an
  // empty one, which is a complete picture of nothing and must not stop a
  // first write from landing. Deliberately NOT in the catch above: a failed
  // read is exactly the case that must withhold permission to write.
  markPendingOpsRead(key);

  if (result.ops.length === 0) return;

  const known: Set<string> = new Set(
    deps.state.getPendingOps(key).map((entry) => entry.operation.op_id),
  );
  const restored: RevfsPendingOp[] = result.ops.filter(
    (entry: RevfsPendingOp) => !known.has(entry.operation.op_id),
  );
  if (restored.length === 0) return;

  debugLog('RevfsService', `Restored ${restored.length} operation(s) queued before this page load`);
  for (const entry of restored) {
    deps.state.addPendingOp(key, entry);
  }
}

/**
 * One retry pass at a time per tree.
 *
 * Two overlapping calls — a double-clicked Sync, or the channel-ready drain
 * firing while a manual Sync is mid-pass — each read the same queue and each
 * re-sent every operation in it: the pass only removes an op AFTER its ack, so
 * a second reader sees the full queue and double-sends it. Chaining per key
 * makes the second call run after the first, against whatever the first left
 * queued.
 */
const retryPassChain: Map<TreeKey, Promise<unknown>> = new Map();

export function retryPendingOps(
  deps: RetryDeps,
  key: TreeKey,
  peerCid: bigint,
): Promise<RetryOutcome> {
  const prev: Promise<unknown> = retryPassChain.get(key) ?? Promise.resolve();
  const runNext = (): Promise<RetryOutcome> => runRetryPass(deps, key, peerCid);
  const pass: Promise<RetryOutcome> = prev.then(runNext, runNext);
  const tail: Promise<unknown> = pass.catch((): undefined => undefined);
  retryPassChain.set(key, tail);
  void tail.then((): void => {
    // Drop the chain entry once the LAST pass settles, so the map does not
    // grow one settled promise per tree for the life of the page.
    if (retryPassChain.get(key) === tail) retryPassChain.delete(key);
  });
  return pass;
}

async function runRetryPass(
  deps: RetryDeps,
  key: TreeKey,
  peerCid: bigint,
): Promise<RetryOutcome> {
  await restorePersistedOps(deps, key);

  const pending: RevfsPendingOp[] = deps.state.getPendingOps(key);
  if (pending.length === 0) return { stillPending: 0, discarded: 0 };

  debugLog('RevfsService', `Retrying ${pending.length} queued operation(s) for ${peerCid}`);

  let discarded: number = 0;

  for (const entry of [...pending]) {
    if (entry.retryCount >= MAX_OP_RETRIES) {
      // Counted, not just logged. `debugLog` is a no-op in production, so
      // "dropped loudly" was silent — and because the drop never reached the
      // caller's count, the very click that discarded a rename for good
      // reported "Tree synced with peer".
      discarded += 1;
      debugLog(
        'RevfsService',
        `Giving up on ${entry.operation.op_type} after ${entry.retryCount} attempts`,
      );
      deps.state.removePendingOp(key, entry.operation.op_id);
      continue;
    }

    const ackPromise: Promise<boolean> = deps.state.registerAck(entry.operation.op_id, ACK_TIMEOUT_MS);
    const sent: boolean = await deps.sendOp(peerCid, entry.operation);
    if (!sent) {
      // The registration was made before the send; nothing can ever answer
      // it now. Withdraw it, or the abandoned promise rejects unheard at its
      // timeout (one unhandledrejection per failed send) — and its stale
      // timer used to evict the NEXT attempt's registration for this op id.
      deps.state.cancelAck(entry.operation.op_id);
      entry.retryCount += 1;
      continue;
    }
    try {
      // The ACK's own answer, not merely its arrival. `registerAck` resolves
      // with the peer's `success` flag, and discarding it retired an operation
      // the receiver had explicitly refused -- which is the same failure the
      // timeout branch below was written to stop, arriving by a different route.
      const acked: boolean = await ackPromise;
      if (acked) {
        deps.state.removePendingOp(key, entry.operation.op_id);
      } else {
        entry.retryCount += 1;
      }
    } catch {
      entry.retryCount += 1;
    }
  }

  await persistPendingOps(deps.io, key, deps.state.getPendingOps(key));
  return { stillPending: deps.state.getPendingOps(key).length, discarded };
}

export async function sendAndAwaitAck(
  deps: RetryDeps,
  peerCid: bigint,
  op: RevfsOperation,
  key: TreeKey,
): Promise<boolean> {
  // Restore before any of the three failure paths below writes the whole
  // queue. `restorePersistedOps` was reachable only from `runRetryPass`, so a
  // session that reloaded while the peer was unreachable held an empty queue,
  // and the first failed send wrote that one operation over everything the
  // previous session had queued. Merging by op_id makes this idempotent, so
  // calling it here costs a read and nothing else.
  await restorePersistedOps(deps, key);

  const ackPromise: Promise<boolean> = deps.state.registerAck(op.op_id, ACK_TIMEOUT_MS);
  const sendResult: boolean = await deps.sendOp(peerCid, op);
  if (!sendResult) {
    // Same as the retry loop above: an unanswerable registration must be
    // withdrawn, not abandoned to reject unheard at its timeout.
    deps.state.cancelAck(op.op_id);
    deps.state.addPendingOp(key, { operation: op, retryCount: 0, createdAt: Date.now() });
    await persistPendingOps(deps.io, key, deps.state.getPendingOps(key));
    return false;
  }
  try {
    // Resolved WITH the peer's answer. Returning `true` for any resolution meant
    // a refusal read exactly like an acceptance: the op left the pending queue
    // and the caller was told the peer had it.
    const acked: boolean = await ackPromise;
    if (!acked) {
      deps.state.addPendingOp(key, { operation: op, retryCount: 0, createdAt: Date.now() });
      await persistPendingOps(deps.io, key, deps.state.getPendingOps(key));
      return false;
    }
    return true;
  } catch {
    // Returned, not swallowed. This resolved `void` either way, so a caller
    // could not tell an acknowledgement from a fifteen-second timeout -- and
    // round 413's diagnostic, sitting after this await, reported
    // "acknowledged by peer" for both. CI then showed exactly that: an ack
    // logged 15.000s after the send, for an op the peer never applied.
    //
    // The op is queued for retry here, which is the right behaviour. Saying it
    // succeeded is not.
    deps.state.addPendingOp(key, { operation: op, retryCount: 0, createdAt: Date.now() });
    await persistPendingOps(deps.io, key, deps.state.getPendingOps(key));
    return false;
  }
}
