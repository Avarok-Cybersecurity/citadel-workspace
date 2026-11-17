/**
 * The bookkeeping that follows appending one message to a page.
 *
 * Split out of the pagination store so the append method holds the decisions
 * (which page, is this a duplicate, does a new page start here) and this holds
 * the arithmetic that must stay consistent with them.
 */
import type { MessagePage, ConversationMetadata, P2PMessage } from './p2p-types';

/** Insert in timestamp order and re-derive the page's bounds. */
export function placeInPage(page: MessagePage, message: P2PMessage): void {
  page.messages.push(message);
  page.messages.sort((a, b) => a.timestamp - b.timestamp);
  page.pageTimestamps.minTimestamp = page.messages[0].timestamp;
  page.pageTimestamps.maxTimestamp = page.messages[page.messages.length - 1].timestamp;
}

/** Advance the conversation's counters for a message just placed in a page. */
export function recordAppend(
  metadata: ConversationMetadata,
  message: P2PMessage,
  isNewConversation: boolean,
  currentCid: bigint | null,
): void {
  metadata.totalMessageCount++;
  metadata.newestMessageTimestamp = message.timestamp;
  // The only message stored is the oldest one, also in a conversation that
  // retention or deletion emptied (its oldest is then 0, which nothing is below).
  if (isNewConversation || metadata.totalMessageCount === 1 || message.timestamp < metadata.oldestMessageTimestamp) {
    metadata.oldestMessageTimestamp = message.timestamp;
  }
  metadata.lastMessageIndex = Math.max(metadata.lastMessageIndex, message.index);
  metadata.lastUpdated = Date.now();

  if (message.senderCid !== currentCid && message.status === 'delivered') {
    metadata.unreadCount++;
  }
}
