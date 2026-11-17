/**
 * Every conversation on this device that belongs to the account reading.
 *
 * LocalDB bucket `0n` is shared by every account in the browser -- the product
 * expects several -- so listing `msgs_with_peer_*_metadata` returns other
 * accounts' conversations too. `ConversationMetadata.ownerCid` exists for
 * exactly that reason, and its doc-comment records what happened without it:
 * `cleanupStaleConversations` treated every other account's history as stale
 * and deleted it.
 *
 * That stamp was wired into the DELETE path and not the READ path, so this
 * function returned everyone's rows and the P2P peer list rendered whom the
 * OTHER account talks to, with their unread counts.
 *
 * Extracted from message-pagination-store.ts at the 250-line cap: reading the
 * shared bucket and deciding whose records they are is one job.
 */
import { websocketService } from '../websocket-service';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { loadMetadataByKey } from './message-page-operations';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { PAGINATED_PREFIX, type ConversationMetadata } from './p2p-types';
import { debugLog } from '@/lib/debug-config';

/**
 * How many conversation reads may be in flight at once.
 *
 * One socket carries them all, so this is a queue depth rather than parallelism: high enough
 * that latency stops dominating boot, low enough that a device with hundreds of conversations
 * does not hand the agent a burst it will serialise anyway.
 */
const METADATA_READ_CONCURRENCY: number = 8;

/** Map with a bounded number of concurrent workers, preserving input order in the output. */
async function mapWithConcurrency<In, Out>(
  items: In[],
  limit: number,
  work: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const out: Out[] = new Array<Out>(items.length);
  let next: number = 0;
  const workers: Array<Promise<void>> = [];
  for (let w: number = 0; w < Math.min(limit, items.length); w++) {
    workers.push(
      (async (): Promise<void> => {
        while (next < items.length) {
          const index: number = next++;
          out[index] = await work(items[index]);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

export async function loadAllMetadata(): Promise<ConversationMetadata[]> {
    const results: ConversationMetadata[] = [];

    try {
      const allKeys: string[] = await websocketService.sendLocalDBListKeys(0n, `${PAGINATED_PREFIX}`);

      if (!allKeys || allKeys.length === 0) {
        debugLog('MessagePaginationStore', '[P2P] No paginated conversations found (fresh install)');
        return results;
      }

      const metadataKeys: string[] = allKeys.filter((key: string) => key.endsWith('_metadata'));
      debugLog('MessagePaginationStore', `[P2P] Found ${metadataKeys.length} conversation metadata keys`);

      // Bucket 0n is shared by every account on this device -- the product
      // expects several -- so these keys include other accounts' conversations.
      // `ownerCid` was added for exactly that reason, and its doc-comment
      // records what happened without it: `cleanupStaleConversations` deleted
      // every other account's history as stale. The stamp was wired into the
      // DELETE path and not this one, so the P2P peer list showed whom the
      // other account talks to, with their unread counts.
      //
      // An unattributed record is returned, not withheld: those predate the
      // stamp, cannot be assigned to anyone, and belong to whoever is reading.
      // Same rule as `loadMetadata`, and the same reason destroying them is
      // unsafe.
      const own: bigint | null = instanceManager.cid;

      // Read the conversations CONCURRENTLY.
      //
      // Each `loadMetadataByKey` is a round trip to the agent -- and on a follower tab, a
      // BroadcastChannel hop to the leader and back on top of that -- so awaiting them one at
      // a time made boot cost N round trips in series. This is on the path to a usable
      // workspace: with twenty conversations it was twenty latencies a person waits through,
      // for data whose parts have no ordering between them.
      //
      // Bounded rather than a bare Promise.all over every key: one socket carries them all, so
      // firing hundreds at once would move the queue rather than remove it. Order is preserved,
      // so the result is identical to the serial version, key for key.
      const loaded: Array<ConversationMetadata | null> = await mapWithConcurrency(
        metadataKeys,
        METADATA_READ_CONCURRENCY,
        async (key: string): Promise<ConversationMetadata | null> => {
          try {
            return await loadMetadataByKey(key);
          } catch (e) {
            debugLog('MessagePaginationStore', `Failed to load metadata for key ${key}:`, e);
            return null;
          }
        },
      );

      metadataKeys.forEach((key: string, index: number) => {
        const metadata: ConversationMetadata | null = loaded[index] ?? null;
        if (!metadata) return;
        const belongsToAnother: boolean =
          own !== null && metadata.ownerCid !== undefined && metadata.ownerCid !== own;
        if (belongsToAnother) {
          debugLog('MessagePaginationStore', `[P2P] Skipping ${key}: another account's conversation`);
        } else {
          results.push(metadata);
        }
      });

      debugLog('MessagePaginationStore', `[P2P] Loaded ${results.length} conversation(s) from paginated storage`);
    } catch (error) {
      if (isGenuinelyAbsent(error)) {
        debugLog('MessagePaginationStore', '[P2P] No paginated conversations found');
      } else {
        debugLog('MessagePaginationStore', 'Failed to load metadata:', error);
      }
    }

    return results;
}
