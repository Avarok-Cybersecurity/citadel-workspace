/**
 * Message revision flow: editing and retracting a sent P2P message.
 *
 * Owns the local-first ordering — the revision is applied to local state and
 * persisted BEFORE the wire send, so a failed send leaves the caller's view
 * consistent and the peer reconciles on next receive. Split from
 * p2p-messenger-manager.ts in the same style as messenger-compatibility.ts:
 * free functions over the conversation manager, so the manager stays a thin
 * orchestrator.
 */

import { createMessageEdit, createMessageDelete , type MessagingLayer } from '@/types/messaging-layer';
import { recordRevision, type RecordedRevision } from './record-revision';
import { resolveCurrentCid } from './messenger-cid-resolver';
import type { ConversationManager } from './conversation-manager';
import type { P2PConversation } from '@/lib/p2p/p2p-types';

type EmitFn = (event: string, data?: unknown) => void;
type SendRawFn = (recipientCid: bigint, layer: MessagingLayer) => Promise<void>;

/**
 * Revise a message we sent, locally and on the peer.
 *
 * Applied locally FIRST so the edit shows immediately and, if the send fails,
 * the throw reaches the caller with the local state already consistent — the
 * peer reconciles on their next receive rather than us silently diverging.
 */
export async function editMessage(
  conversationManager: ConversationManager,
  emit: EmitFn,
  sendRawMessage: SendRawFn,
  peerCid: bigint,
  messageId: string,
  contents: string,
): Promise<void> {
  const ownCid: bigint | null = await resolveCurrentCid();
  if (!ownCid) throw new Error('Not connected to server');

  // Optional: after a reload the conversation exists with an empty window, and
  // the message being edited is found on its page (record-revision).
  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);

  const editedAt: number = Date.now();
  const outcome: RecordedRevision = await recordRevision(conversation, peerCid, messageId, ownCid, { kind: 'edit', contents, editedAt });
  if (!outcome.applied) {
    // 'not-sender' here means the UI offered edit on someone else's message.
    throw new Error(`Cannot edit message ${messageId}: ${outcome.reason}`);
  }
  // Fail before the edit is announced or sent, so a storage failure cannot
  // leave the peer with a revision the local transcript does not have.
  if (!outcome.persisted) {
    throw new Error(
      `Cannot edit message ${messageId}: it could not be written to the stored transcript, ` +
      'so the edit would be lost on reload. Nothing was sent to the peer.',
    );
  }
  emit('p2p:message-updated', outcome.message);

  await sendRawMessage(peerCid, createMessageEdit(messageId, contents, editedAt));
}

/**
 * Retract a message we sent, locally and on the peer. Removes it outright,
 * matching how group chat already treats a deletion.
 */
export async function deleteMessage(
  conversationManager: ConversationManager,
  emit: EmitFn,
  sendRawMessage: SendRawFn,
  peerCid: bigint,
  messageId: string,
): Promise<void> {
  const ownCid: bigint | null = await resolveCurrentCid();
  if (!ownCid) throw new Error('Not connected to server');

  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);

  const deletedAt: number = Date.now();
  const outcome: RecordedRevision = await recordRevision(conversation, peerCid, messageId, ownCid, { kind: 'delete' });
  if (!outcome.applied) {
    throw new Error(`Cannot delete message ${messageId}: ${outcome.reason}`);
  }
  // Persisted, not just emitted: the page a reload reads is the transcript. A
  // retraction the store did not take would return on reload, out of step with
  // the peer, so it throws BEFORE the retraction is sent.
  if (!outcome.persisted) {
    throw new Error(
      `Cannot delete message ${messageId}: it could not be removed from the stored transcript, ` +
      'so it would return on reload. Nothing was sent to the peer.',
    );
  }
  emit('p2p:message-deleted', { peerCid, messageId });

  await sendRawMessage(peerCid, createMessageDelete(messageId, deletedAt));
}
