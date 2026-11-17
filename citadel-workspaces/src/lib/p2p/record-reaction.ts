/**
 * One reaction change, applied where it is stored and where it is shown.
 *
 * Shared by the inbound and outbound halves so they cannot disagree about the
 * order. The STORED page is folded first and is authoritative: it holds the
 * message whether or not the in-memory window does (see message-page-reaction).
 * The in-memory copy, when there is one, is then given the stored result rather
 * than folded separately, so the two cannot drift.
 *
 * A message in memory but in no page -- one whose append has not landed yet --
 * is folded in memory only and reported `persisted: false`, which each caller
 * turns into its own failure report.
 */
import type { ReactionChange } from '@/lib/reactions/reaction-state';
import { applyReaction } from './message-reaction';
import { messagePaginationStore } from './message-pagination-store';
import type { StoredReactionOutcome } from './message-page-reaction';
import type { P2PConversation, P2PMessage } from './p2p-types';

export type RecordedReaction =
  | { applied: true; message: P2PMessage; persisted: boolean }
  | { applied: false; reason: 'unknown-message' | 'no-change' };

export async function recordReaction(
  conversation: P2PConversation | undefined,
  peerCid: bigint,
  messageId: string,
  change: ReactionChange,
): Promise<RecordedReaction> {
  const stored: StoredReactionOutcome = await messagePaginationStore.reactToMessageInPages(peerCid, messageId, change);
  const held: P2PMessage | undefined = conversation?.messages.find((m) => m.id === messageId);

  if (stored.kind === 'applied') {
    if (held) held.reactions = stored.message.reactions;
    return { applied: true, message: held ?? stored.message, persisted: true };
  }
  if (stored.kind === 'no-change') return { applied: false, reason: 'no-change' };
  if (!conversation) return { applied: false, reason: 'unknown-message' };

  const inMemory: ReturnType<typeof applyReaction> = applyReaction(conversation, messageId, change);
  return inMemory.applied ? { applied: true, message: inMemory.message, persisted: false } : inMemory;
}

/** The reactions a message holds now, from memory if it is there, else from its page. */
export async function currentReactions(
  conversation: P2PConversation | undefined,
  peerCid: bigint,
  messageId: string,
): Promise<P2PMessage['reactions']> {
  const held: P2PMessage | undefined = conversation?.messages.find((m) => m.id === messageId);
  if (held) return held.reactions;
  return (await messagePaginationStore.findMessageInPages(peerCid, messageId))?.reactions;
}
