/**
 * Applying an incoming edit or delete to a conversation.
 *
 * P2P chat had no way to revise a message: the adapter's editMessage and
 * deleteMessage both threw "P2P messaging does not support …", so the ⋯ menu on
 * a bubble had nothing to call even where it rendered. Group chat already
 * supported both, so this deliberately mirrors its semantics rather than
 * inventing a second convention:
 *
 *   edit    replaces the contents in place and stamps edited_at
 *   delete  removes the message, exactly as groupMessagingManager
 *           .handleMessageDeleted filters it out — no tombstone, because group
 *           chat does not render one either
 *
 * Kept pure and separate from the router so the outcome can be tested without a
 * socket, a conversation store, or an event emitter.
 */

import type { P2PConversation, P2PMessage } from './p2p-types';

export type RevisionOutcome =
  | { applied: true; message: P2PMessage }
  | { applied: false; reason: 'unknown-message' | 'not-sender' };

/**
 * Replace a message's contents.
 *
 * Only the original sender may revise a message. A peer that edits someone
 * else's message is rejected rather than trusted — the conversation is shared
 * state and the sender field is the only claim we can check.
 */
export function applyEdit(
  conversation: P2PConversation,
  messageId: string,
  contents: string,
  editedAt: number,
  editorCid: bigint,
): RevisionOutcome {
  const message: P2PMessage | undefined = conversation.messages.find((m) => m.id === messageId);
  if (!message) return { applied: false, reason: 'unknown-message' };
  if (message.senderCid !== editorCid) return { applied: false, reason: 'not-sender' };

  message.content = contents;
  message.edited_at = editedAt;
  return { applied: true, message };
}

/**
 * Remove a message from the conversation.
 *
 * Same sender check as applyEdit: a peer may retract their own message, not
 * yours.
 */
export function applyDelete(
  conversation: P2PConversation,
  messageId: string,
  deleterCid: bigint,
): RevisionOutcome {
  const index: number = conversation.messages.findIndex((m) => m.id === messageId);
  if (index === -1) return { applied: false, reason: 'unknown-message' };

  const message: P2PMessage = conversation.messages[index];
  if (message.senderCid !== deleterCid) return { applied: false, reason: 'not-sender' };

  conversation.messages.splice(index, 1);
  return { applied: true, message };
}
