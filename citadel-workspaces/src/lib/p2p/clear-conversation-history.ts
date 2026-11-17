import { messagePaginationStore } from './message-pagination-store';
import { resolveCurrentCid } from './messenger-cid-resolver';
import { eventEmitter } from '@/lib/event-emitter';
import type { ConversationManager } from './conversation-manager';

/**
 * Erase the stored history for one peer, for real.
 *
 * Chat Settings offered "Clear Chat History" and ran
 * `localStorage.removeItem('chat-history:' + peerCid)` — a key nothing in the
 * app has ever written. The dialog said "Messages stored on this device are
 * removed. This cannot be undone." and not one message was removed. In a
 * product sold on privacy that is the worst kind of defect: the user is told
 * their data is gone and it is not.
 *
 * Both halves are needed. deleteConversationPages clears what survives a
 * reload; clearMessages clears what is on screen now.
 */
export async function clearConversationHistory(conversationManager: ConversationManager, peerCid: bigint): Promise<void> {
  // includeUnattributed: the user has this conversation open and pressed
  // clear. Refusing on an unstamped legacy record would make their own
  // button do nothing.
  await messagePaginationStore.deleteConversationPages(peerCid, {
    ownerCid: await resolveCurrentCid(),
    includeUnattributed: true,
  });
  conversationManager.clearMessages(peerCid);
  eventEmitter.emit('p2p:conversation-cleared', { peerCid });
}
