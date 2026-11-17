/**
 * Writing the tree to disk, with a failure the user can actually find out about.
 *
 * `RevfsIO.execute` never rejects — a full disk, a revoked OPFS handle or a
 * serialisation error all come back as `{ success: false }` on a resolved
 * promise. Every one of the twenty call sites did `await io.execute({ type:
 * 'persist-tree', ... })` and discarded that, so the in-memory tree and the disk
 * diverged silently and the divergence surfaced only as "my folder is gone"
 * after the next reload.
 *
 * Deliberately NOT a throw. By the time this runs the in-memory tree has already
 * been mutated and, for a peer operation, the op may already have been sent —
 * so throwing would report a failure for something that partly succeeded, and
 * leave the caller no way to distinguish the two. The operation DID happen; what
 * failed is its durability.
 *
 * So: one event, raised once, from one place. Whoever wires a "changes may not
 * survive a reload" notice does it here rather than at twenty call sites, and
 * until then the failure is at least loud in the log instead of absent.
 *
 * AND: it refuses to write a tree for a key that was never successfully read.
 *
 * `getTree` already knows the difference between "no tree yet" and "the tree
 * could not be read", and its own comment spells out the stake — "writes that
 * default over a tree still on disk, and the user's files are gone". It
 * correctly refuses to persist. But it still RETURNS the empty default to its
 * caller, and all twenty callers write the whole tree back through this
 * function, which had no such guard. So the fix stopped `getTree` destroying the
 * index and left every one of its callers doing it.
 *
 * The worst path needs no action by the person who loses the data: an inbound
 * peer operation (`revfs-inbound.ts`) reads the tree, applies the peer's mkdir
 * to the empty default, and persists three nodes over forty. Bob's folder
 * creation destroys Alice's file index, the write SUCCEEDS so no failure event
 * fires, and the blobs remain on the backend with nothing left pointing at
 * them.
 *
 * `persistPendingOps` is this function's twin for the retry queue and has
 * carried exactly this guard all along, with a header saying it belongs "on the
 * single function every write funnels through, not at the call sites". This is
 * that function, for trees.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { debugLog, errorLog } from '@/lib/debug-config';
import type { RevfsIO } from './revfs-io';
import type { RevfsNode } from '@/types/revfs-types';
import type { RevfsIntentResult } from '@/types/revfs-intents';

/**
 * Keys whose tree was successfully READ, so writing one cannot erase what is on
 * disk. Per key, not one flag: reading peer A's tree says nothing about peer B's.
 */
const readKeys: Set<string> = new Set<string>();

/** Record that a key's tree was read, whatever it found — including "absent". */
export function markTreeRead(treeKey: string): void {
  readKeys.add(treeKey);
}

/** For tests: forget what has been read, so a scenario starts cold. */
export function resetTreeReadTracking(): void {
  readKeys.clear();
}

export async function persistTree(io: RevfsIO, treeKey: string, tree: RevfsNode): Promise<void> {
  if (!readKeys.has(treeKey)) {
    // Refusing is the point. A tree assembled without a successful read is
    // whatever this session happens to hold -- for an unreadable key, the empty
    // default -- and writing it replaces the real index. Losing this write
    // costs one operation; making it costs every file the user has.
    errorLog(
      'RevfsPersist',
      `Refusing to write the tree for ${treeKey}: it was never successfully read, so this ` +
        'would replace whatever is on disk with a default',
    );
    eventEmitter.emit('revfs:persist-failed', { treeKey });
    return;
  }

  const result: RevfsIntentResult = await io.execute({ type: 'persist-tree', treeKey, tree });

  if (result.type !== 'persist-tree' || !result.success) {
    debugLog('RevfsPersist', `Tree ${treeKey} could not be written to disk — changes may not survive a reload`);
    eventEmitter.emit('revfs:persist-failed', { treeKey });
  }
}
