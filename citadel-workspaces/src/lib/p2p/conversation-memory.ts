/**
 * The in-memory window onto a conversation: what is on screen without a read.
 *
 * Split from conversation-manager.ts so the two writers of that window share
 * one rule set: the browser store's path (which also writes the page) and the
 * agent's event stream (multi-window, agent 0.8.6), which must not write the
 * page -- the agent already has.
 */
import { debugLog } from '@/lib/debug-config';
import type { P2PMessage, P2PConversation, MessageCache } from './p2p-types';

/** Add `message` to the window; `false` if it was already there. */
export function holdMessage(cache: MessageCache, conversation: P2PConversation, message: P2PMessage): boolean {
  if (conversation.messages.find(m => m.id === message.id)) {
    debugLog('ConversationManager', '[P2P] Duplicate message detected, skipping add:', message.id);
    return false;
  }

  // Paired with [LOSS-DIAG] in message-handler-routing: records what the
  // conversation held before and after, so a message that is added here but
  // absent from the rendered list can be told apart from one that never
  // arrived. See the reconnect entry in WORKSPACE_IMPLEMENTATION_GAPS.
  debugLog(
    'ConversationManager',
    `[LOSS-DIAG] adding id=${message.id} to peer=${conversation.peerCid.toString().slice(0, 8)} ` +
      `had=${conversation.messages.length}`,
  );

  conversation.messages.push(message);
  conversation.lastMessageIndex = Math.max(conversation.lastMessageIndex, message.index);
  conversation.messages.sort((a, b) => a.timestamp - b.timestamp);

  if (conversation.messages.length > cache.maxMessagesPerConversation) {
    conversation.messages.splice(0, conversation.messages.length - cache.maxMessagesPerConversation);
  }

  cache.messageQueue.push(message);
  if (cache.messageQueue.length > cache.maxQueueSize) {
    cache.messageQueue.splice(0, cache.messageQueue.length - cache.maxQueueSize);
  }
  return true;
}

/**
 * Replace the held copy of `message`. A window that does not hold it (it was
 * paged out, or never loaded) has nothing to replace: the open view hears the
 * change through 'p2p:message-updated' either way.
 */
export function replaceHeld(conversation: P2PConversation, message: P2PMessage): void {
  const at: number = conversation.messages.findIndex(m => m.id === message.id);
  if (at >= 0) conversation.messages[at] = message;
}

/** Drop `messageId` from the window. */
export function dropHeld(conversation: P2PConversation, messageId: string): void {
  conversation.messages = conversation.messages.filter(m => m.id !== messageId);
}
