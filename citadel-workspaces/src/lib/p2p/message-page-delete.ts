/**
 * Deleting a stored conversation, with the ownership rules that make it safe.
 *
 * Split from message-page-operations to keep that module under the file cap.
 */
import { websocketService } from '../websocket-service';
import { conversationPrefix } from './message-page-keys';
import { loadMetadata } from './message-page-operations';
import { debugLog } from '@/lib/debug-config';
import type { ConversationMetadata } from '@/lib/p2p/p2p-types';

/** The account performing the delete. */
export interface DeleteScope {
  ownerCid: bigint | null;
}

/**
 * Delete all pages and metadata for this account's conversation with the peer. Only a record
 * stamped for the account deleting is removed: bucket `0n` is shared by every account on the
 * device.
 */
export async function deleteConversationPages(peerCid: bigint, scope: DeleteScope): Promise<void> {
  const metadata: ConversationMetadata | null = await loadMetadata(peerCid);
  if (!metadata) return;
  if (scope.ownerCid === null || metadata.ownerCid !== scope.ownerCid) {
    debugLog('MessagePageOperations', `[P2P] Refusing to delete conversation ${peerCid.toString().slice(0, 8)}: it belongs to another account`);
    return;
  }

  const deletePromises: Promise<void>[] = [];
  for (let pageNum: number = 0; pageNum <= metadata.latestPage; pageNum++) {
    deletePromises.push(websocketService.sendLocalDBDelete(0n, `${conversationPrefix(peerCid)}_${pageNum}`));
  }
  deletePromises.push(websocketService.sendLocalDBDelete(0n, `${conversationPrefix(peerCid)}_metadata`));
  await Promise.all(deletePromises);
  debugLog('MessagePageOperations', `[P2P] Deleted ${metadata.latestPage + 1} pages + metadata for peer ${peerCid.toString().slice(0, 8)}...`);
}
