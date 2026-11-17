/**
 * Applying a reaction change to a P2P conversation.
 *
 * The sibling of message-revision.ts, with one difference that is the point:
 * an edit is refused unless the editor SENT the message, while anyone in the
 * conversation may react to any message. What a reactor may not do is touch
 * another reactor's entry, and that is guaranteed by `change.reactorCid`, which
 * every caller takes from the transport (see lib/reactions/reaction-state).
 */
import { foldReaction, type MessageReaction, type ReactionChange } from '@/lib/reactions/reaction-state';
import type { P2PConversation, P2PMessage } from './p2p-types';

export type ReactionOutcome =
  | { applied: true; message: P2PMessage }
  | { applied: false; reason: 'unknown-message' | 'no-change' };

export function applyReaction(
  conversation: P2PConversation,
  messageId: string,
  change: ReactionChange,
): ReactionOutcome {
  const message: P2PMessage | undefined = conversation.messages.find((m) => m.id === messageId);
  if (!message) return { applied: false, reason: 'unknown-message' };
  const next: MessageReaction[] | null = foldReaction(message.reactions, change);
  if (!next) return { applied: false, reason: 'no-change' };
  message.reactions = next;
  return { applied: true, message };
}
