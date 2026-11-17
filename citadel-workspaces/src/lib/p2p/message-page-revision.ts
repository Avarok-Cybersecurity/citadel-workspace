/**
 * Applying an edit or a delete to the stored page that holds its message.
 *
 * The page, not the in-memory window, is where a revision has to land.
 * `loadFromStorage` restores every conversation with EMPTY `messages`, and the
 * window holds only the latest 100, so after a reload an incoming edit or
 * delete looked for its message in memory, found nothing and was dropped as
 * "unknown-message" -- the receiver kept the old text, or the retracted
 * message, for good. Reactions had the same hole (message-page-reaction).
 *
 * The sender check is made HERE, against the stored message: it is the copy
 * that exists whether or not memory does, and the one a reload renders.
 * Called under the caller's per-peer lock, like the other page mutations.
 */
import { tryLoadMetadata, tryLoadMessagePage, saveMessagePage } from './message-page-operations';
import { removeMessageFromPages } from './message-metadata-mutations';
import type { ConversationMetadata, MessagePage, P2PMessage } from './p2p-types';

export type PageRevision =
  | { kind: 'edit'; contents: string; editedAt: number }
  | { kind: 'delete' };

export type StoredRevisionOutcome =
  | { kind: 'applied'; message: P2PMessage }
  | { kind: 'not-sender' }
  | { kind: 'unknown-message' };

export async function reviseMessageInPages(
  peerCid: bigint,
  messageId: string,
  reviserCid: bigint,
  revision: PageRevision,
): Promise<StoredRevisionOutcome> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata) return { kind: 'unknown-message' };

  for (let pageNum: number = metadata.latestPage; pageNum >= 0; pageNum--) {
    const page: MessagePage | null = await tryLoadMessagePage(peerCid, pageNum);
    const index: number = page ? page.messages.findIndex((m) => m.id === messageId) : -1;
    if (!page || index === -1) continue;

    const stored: P2PMessage = page.messages[index];
    if (stored.senderCid !== reviserCid) return { kind: 'not-sender' };

    if (revision.kind === 'delete') {
      // The existing removal, so the message count is kept in step as before.
      return (await removeMessageFromPages(peerCid, messageId)) ? { kind: 'applied', message: stored } : { kind: 'unknown-message' };
    }
    const message: P2PMessage = { ...stored, content: revision.contents, edited_at: revision.editedAt };
    page.messages[index] = message;
    await saveMessagePage(peerCid, pageNum, page);
    return { kind: 'applied', message };
  }
  return { kind: 'unknown-message' };
}
