/**
 * Folding a reaction change into the stored page that holds its message.
 *
 * The page, not the in-memory window, is where a reaction has to be applied.
 * `loadFromStorage` restores every conversation with EMPTY `messages`, and the
 * window holds only the latest 100 anyway, so after a reload a peer's removal
 * looked for its message in memory, found nothing and was dropped as
 * "unknown-message" -- while the add it was retracting sat on disk and kept
 * rendering. (`findMessageInPages` exists for the same reason on the resend
 * path.) Called under the caller's per-peer lock, like the other mutations.
 */
import { foldReaction, type MessageReaction, type ReactionChange } from '@/lib/reactions/reaction-state';
import { tryLoadMetadata, tryLoadMessagePage, saveMessagePage } from './message-page-operations';
import type { ConversationMetadata, MessagePage, P2PMessage } from './p2p-types';

export type StoredReactionOutcome =
  | { kind: 'applied'; message: P2PMessage }
  | { kind: 'no-change' }
  | { kind: 'unknown-message' };

export async function reactToMessageInPages(
  peerCid: bigint,
  messageId: string,
  change: ReactionChange,
): Promise<StoredReactionOutcome> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata) return { kind: 'unknown-message' };

  for (let pageNum: number = metadata.latestPage; pageNum >= 0; pageNum--) {
    const page: MessagePage | null = await tryLoadMessagePage(peerCid, pageNum);
    const index: number = page ? page.messages.findIndex((m) => m.id === messageId) : -1;
    if (!page || index === -1) continue;

    const reactions: MessageReaction[] | null = foldReaction(page.messages[index].reactions, change);
    if (!reactions) return { kind: 'no-change' };
    const message: P2PMessage = { ...page.messages[index], reactions };
    page.messages[index] = message;
    await saveMessagePage(peerCid, pageNum, page);
    return { kind: 'applied', message };
  }
  return { kind: 'unknown-message' };
}
