/**
 * Reacting to a P2P message: toggle our own reaction, locally and on the peer.
 *
 * Same local-first ordering as messenger-revision.ts, for the same reasons:
 * applied and PERSISTED before the send, and a storage failure throws before
 * anything is sent, so the peer never holds a reaction our reload would lose.
 * Works on the stored page when the in-memory window lacks the message, which
 * after a reload it always does (see message-page-reaction).
 */
import { MessagingLayerType } from '@/types/messaging-layer';
import { toggleReaction, type ReactionChange } from '@/lib/reactions/reaction-state';
import { recordReaction, currentReactions, type RecordedReaction } from './record-reaction';
import { resolveCurrentCid } from './messenger-cid-resolver';
import type { ConversationManager } from './conversation-manager';
import type { P2PConversation, P2PMessage } from './p2p-types';
import type { MessagingLayer } from '@/types/messaging-layer';

type EmitFn = (event: string, data?: unknown) => void;
type SendRawFn = (recipientCid: bigint, layer: MessagingLayer) => Promise<void>;

export async function reactToMessage(
  conversationManager: ConversationManager,
  emit: EmitFn,
  sendRawMessage: SendRawFn,
  peerCid: bigint,
  messageId: string,
  emoji: string,
): Promise<void> {
  const ownCid: bigint | null = await resolveCurrentCid();
  if (!ownCid) throw new Error('Not connected to server');

  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);

  // Read from the page when the window does not hold it: after a reload it
  // holds nothing, and toggling against an empty list turned "remove" into "add".
  const held: P2PMessage['reactions'] = await currentReactions(conversation, peerCid, messageId);
  const change: ReactionChange = toggleReaction(held, emoji, ownCid, Date.now());
  const outcome: RecordedReaction = await recordReaction(conversation, peerCid, messageId, change);
  if (!outcome.applied) throw new Error(`Cannot react to message ${messageId}: ${outcome.reason}`);
  if (!outcome.persisted) {
    throw new Error(
      `Cannot react to message ${messageId}: it could not be written to the stored transcript, ` +
      'so the reaction would be lost on reload. Nothing was sent to the peer.',
    );
  }
  emit('p2p:message-updated', outcome.message);

  await sendRawMessage(peerCid, {
    type: MessagingLayerType.MessageReaction,
    message_id: messageId,
    emoji: change.emoji,
    active: change.active,
    reacted_at: change.at,
  });
}
