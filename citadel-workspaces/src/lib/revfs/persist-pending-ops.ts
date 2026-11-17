/**
 * Writing the retry queue to disk, with a failure the user can find out about.
 *
 * The twin of `persistTree`, and written because that fix was applied to one of
 * the two places it belongs. `RevfsIO.execute` never rejects — a full disk, a
 * revoked OPFS handle or a serialisation error all come back as
 * `{ success: false }` on a resolved promise — and all four `persist-pending-ops`
 * call sites in revfs-retry.ts discarded that result.
 *
 * The pending queue holds operations a peer has not acknowledged. Losing its
 * durability means those operations are gone on the next reload: the user made
 * edits, the app queued them for retry, the write failed, and nothing said so.
 * `PersistFailureNotice` was already built and already listening for exactly
 * this — it just never heard about this half.
 *
 * Deliberately NOT a throw, for the same reason `persistTree` is not: by the
 * time this runs the in-memory queue is already correct, and the operation the
 * caller asked about did happen. What failed is its survival of a reload.
 *
 * The gate that should have caught this could not: its regex matched
 * `await io.execute({` but not `await deps.io.execute({`, so it evaluated zero
 * sites in the whole tree and reported success on every run.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { errorLog } from '@/lib/debug-config';
import type { RevfsIO } from './revfs-io';
import type { RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsPendingOp, TreeKey } from '@/types/revfs-types';

/**
 * Tree keys whose persisted queue has actually been read into memory.
 *
 * `persistPendingOps` writes the WHOLE queue for a key. That is sound only
 * when the in-memory queue came from disk. `sendAndAwaitAck` persisted on all
 * three of its failure paths and never restored -- `restorePersistedOps` was
 * reachable only from `runRetryPass` -- so a page that reloaded while a peer
 * was unreachable, then queued one new operation, wrote a queue of exactly
 * that one over everything the previous session had queued.
 *
 * That is the sixth site of this mechanism in this codebase. The others are
 * the session upsert helper, peer-registration-store, live-document-store,
 * connection/io-websocket and group-conversations, and the guard is in the
 * same place each time: on the single function every write funnels through,
 * not at the call sites, because covering some of them is the defect rather
 * than the fix.
 *
 * Per KEY, not one flag: a queue read for peer A says nothing about peer B's.
 */
const readKeys: Set<string> = new Set<string>();

/** Record that a key's queue was read, whatever it found. */
export function markPendingOpsRead(key: TreeKey): void {
  readKeys.add(String(key));
}

/** For tests: forget what has been read, so a scenario starts cold. */
export function resetPendingOpsReadTracking(): void {
  readKeys.clear();
}

export async function persistPendingOps(
  io: RevfsIO,
  treeKey: TreeKey,
  ops: RevfsPendingOp[],
): Promise<void> {
  if (!readKeys.has(String(treeKey))) {
    // Refusing is the point: writing a queue assembled without a read
    // replaces whatever is stored with whatever this session happens to hold.
    errorLog('RevfsService', `Refusing to write the retry queue for ${String(treeKey)}: it was never read`);
    return;
  }

  const result: RevfsIntentResult | undefined = await io.execute({
    type: 'persist-pending-ops',
    treeKey,
    ops,
  });

  // `result?.` rather than `result.`: the type says a result always comes back,
  // and in production it does. But a helper that THROWS on an unexpected shape
  // turns "the write may not have happened" into "the caller's operation blew
  // up", which is strictly worse than reading it as the failure it is. Several
  // test doubles resolve `undefined` here, and each of them is asking the same
  // question this branch answers: did the write succeed? Not knowing is no.
  if (result?.type !== 'persist-pending-ops' || !result.success) {
    // errorLog, not debugLog: debugLog is a no-op in production, which is the
    // only build where this failure matters to anyone.
    errorLog(
      'RevfsPersist',
      `Pending operations for ${treeKey} could not be written to disk — queued changes may not survive a reload`,
    );
    eventEmitter.emit('revfs:persist-failed', { treeKey });
  }
}
