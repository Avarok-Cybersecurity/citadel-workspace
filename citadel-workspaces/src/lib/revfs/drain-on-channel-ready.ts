/**
 * Drain the RE-VFS retry queue when a P2P channel actually comes up.
 *
 * `retryPendingOps` was documented as "call when a channel becomes usable",
 * but its only production caller was the file manager's manual Sync button —
 * nothing listened for the channel itself. So operations queued while a peer
 * was unreachable, INCLUDING deletions whose local bytes were already
 * destroyed, sat indefinitely unless the user happened to press Sync; until
 * then the peer's next SyncResponse could resurrect the very paths the queue
 * was waiting to remove.
 *
 * The real signal exists: `p2p-auto-connect-service/service.ts` emits
 * `p2p:channel-ready { peerCid }` when a message channel to a peer is first
 * proven usable. This module subscribes RE-VFS to it. Separate from
 * `revfs-service.ts` only for the 250-line cap; the service wires it in
 * `initialize`, so a drain can never run against an engine with no transport.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { peerTreeKey } from './tree-queries';
import { debugLog } from '@/lib/debug-config';
import type { TreeKey } from '@/types/revfs-types';
import type { RetryOutcome } from './revfs-retry';

export interface DrainDeps {
  getCurrentCid: () => Promise<bigint | null>;
  retryPendingOps: (key: TreeKey, peerCid: bigint) => Promise<RetryOutcome>;
}

async function drainForPeer(deps: DrainDeps, peerCid: bigint): Promise<void> {
  const myCid: bigint | null = await deps.getCurrentCid();
  if (myCid === null) {
    // No session yet — there is no tree key to drain under. The queue is not
    // lost; the next channel-ready (or a manual Sync) will find it.
    debugLog('RevfsService', 'channel-ready drain skipped: no current CID');
    return;
  }
  const outcome: RetryOutcome = await deps.retryPendingOps(peerTreeKey(myCid, peerCid), peerCid);
  if (outcome.stillPending > 0 || outcome.discarded > 0) {
    debugLog('RevfsService', `channel-ready drain for ${peerCid}: ${outcome.stillPending} still pending, ${outcome.discarded} discarded`);
  }
}

/**
 * Subscribe the drain to `p2p:channel-ready`. Returns the unsubscribe.
 */
export function wireDrainOnChannelReady(deps: DrainDeps): () => void {
  return eventEmitter.on<{ peerCid?: bigint }>('p2p:channel-ready', (payload): void => {
    const peerCid: bigint | undefined = payload?.peerCid;
    if (typeof peerCid !== 'bigint') return;
    drainForPeer(deps, peerCid).catch((error: unknown): void => {
      // A failed drain is a retry that will happen again; it must not become
      // an unhandled rejection inside an event handler.
      debugLog('RevfsService', 'channel-ready drain failed', error);
    });
  });
}
