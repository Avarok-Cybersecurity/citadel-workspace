/**
 * Deleting a stored conversation, with the ownership rules that make it safe.
 *
 * Split from message-page-operations to keep that module under the file cap.
 */
import { websocketService } from '../websocket-service';
import { conversationPrefix, legacyConversationPrefix, hasLegacyFallback } from './message-page-keys';
import { loadMetadata, loadMetadataByKey } from './message-page-operations';
import { debugLog } from '@/lib/debug-config';
import type { ConversationMetadata } from '@/lib/p2p/p2p-types';

/**
 * Delete all pages and metadata for a conversation.
 */
export interface DeleteScope {
  /** The account performing the delete. */
  ownerCid: bigint | null;
  /**
   * Whether records with no recorded owner may be deleted.
   *
   * False for the automatic sweep, true for an explicit "clear this
   * conversation" — the user has that conversation open and is acting on it
   * deliberately, so refusing would make their own button silently do nothing.
   * A sweep has no such mandate.
   */
  includeUnattributed: boolean;
}

/**
 * May this account delete this stored record?
 *
 * Pages live in LocalDB bucket `0n`, shared by every account on the device.
 * `cleanupStaleConversations` deletes any cached conversation missing from the
 * CURRENT account's peer list — which is true of every conversation belonging to
 * a DIFFERENT account. A second user logging in permanently destroyed the first
 * user's message history, on a device this product explicitly expects to hold
 * several accounts.
 *
 * Asked per RECORD, not once per conversation: a conversation can be stored
 * under both the account-scoped key and the legacy peer-only key, with different
 * owners, and proving one says nothing about the other.
 */
function mayDelete(record: ConversationMetadata, scope: DeleteScope, peerCid: bigint): boolean {
  if (record.ownerCid === undefined) {
    if (!scope.includeUnattributed) {
      debugLog('MessagePageOperations', `[P2P] Keeping unattributed conversation ${peerCid.toString().slice(0, 8)}: owner unknown`);
      return false;
    }
    return true;
  }
  if (scope.ownerCid === null || record.ownerCid !== scope.ownerCid) {
    debugLog('MessagePageOperations', `[P2P] Refusing to delete conversation ${peerCid.toString().slice(0, 8)}: it belongs to another account`);
    return false;
  }
  return true;
}

export async function deleteConversationPages(peerCid: bigint, scope: DeleteScope): Promise<void> {
  const metadata: ConversationMetadata | null = await loadMetadata(peerCid);
  if (!metadata) return;

  // Delete only what we can PROVE belongs to the account doing the deleting.
  //
  // Pages live in LocalDB bucket `0n`, shared by every account on the device,
  // and are keyed by peer alone. cleanupStaleConversations deletes any cached
  // conversation missing from the CURRENT account's peer list — which is true
  // of every conversation belonging to a DIFFERENT account. A second user
  // logging in permanently destroyed the first user's message history, on a
  // device this product explicitly expects to hold several accounts.
  if (!mayDelete(metadata, scope, peerCid)) return;

  const deletePromises: Promise<void>[] = [];
  for (let pageNum: number = 0; pageNum <= metadata.latestPage; pageNum++) {
    const key: string = `${conversationPrefix(peerCid)}_${pageNum}`;
    deletePromises.push(websocketService.sendLocalDBDelete(0n, key));
  }

  const metadataKey: string = `${conversationPrefix(peerCid)}_metadata`;
  deletePromises.push(websocketService.sendLocalDBDelete(0n, metadataKey));

  // The legacy peer-only records too, or the read fallback resurrects the
  // conversation the user was told could not be undone.
  //
  // These are a DIFFERENT record with a different owner stamp, and the check
  // above ran against the scoped one. This comment used to claim the check
  // "has already run, so this only removes records that are ours" — it had not
  // run on anything here. With two accounts on one device that had both chatted
  // with the same peer, B's Clear Chat History passed on B's own scoped record
  // and then deleted A's legacy pages, which nothing had looked at. So ask the
  // legacy record its own owner, with the same rule, and use its own page count
  // — the scoped record's `latestPage` also left every page above it orphaned.
  if (hasLegacyFallback(peerCid)) {
    const legacy: string = legacyConversationPrefix(peerCid);
    const legacyMetadata: ConversationMetadata | null = await loadMetadataByKey(`${legacy}_metadata`);
    // No legacy metadata is the unattributed case: there is no stamp to prove
    // ownership either way, so it follows the same rule an unstamped record
    // does — an explicit clear may remove it, a background sweep may not.
    const legacyPages: number = legacyMetadata ? legacyMetadata.latestPage : metadata.latestPage;
    const legacyAllowed: boolean = legacyMetadata
      ? mayDelete(legacyMetadata, scope, peerCid)
      : scope.includeUnattributed;
    if (legacyAllowed) {
      for (let pageNum: number = 0; pageNum <= legacyPages; pageNum++) {
        deletePromises.push(websocketService.sendLocalDBDelete(0n, `${legacy}_${pageNum}`));
      }
      deletePromises.push(websocketService.sendLocalDBDelete(0n, `${legacy}_metadata`));
    }
  }

  await Promise.all(deletePromises);
  debugLog('MessagePageOperations', `[P2P] Deleted ${metadata.latestPage + 1} pages + metadata for peer ${peerCid.toString().slice(0, 8)}...`);
}
