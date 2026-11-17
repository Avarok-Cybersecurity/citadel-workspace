/**
 * In-place edits to a conversation's stored pages and metadata.
 *
 * Split from message-pagination-store so that file keeps the append/rollover
 * path — where the ordering and atomicity reasoning lives — and these three
 * read-modify-write helpers live together. Every one is called under the
 * caller's per-peer lock; none takes one itself.
 */

import {
  tryLoadMetadata,
  tryLoadMessagePage,
  saveMessagePage,
  saveMetadata,
} from './message-page-operations';
import type { P2PMessage } from './p2p-types';
import type { ConversationMetadata, MessagePage } from '@/lib/p2p/p2p-types';

/**
 * Patch one message wherever it is stored.
 *
 * Returns false when the id is in no page — the normal way of reporting
 * "nothing was written", which callers must distinguish from a throw.
 */
/**
 * Find a stored message by id, newest page first.
 *
 * The in-memory window is capped at 100 and is restored EMPTY after a reload, so
 * a lookup that consults only that window cannot see most of a conversation.
 * `resendMessage` did exactly that, which made the persisted `failed` status —
 * kept deliberately *"because it is what makes the message retryable after a
 * reload"* — a promise nothing could honour: every retry click threw
 * "not found in conversation".
 */
export async function findMessageInPages(
  peerCid: bigint,
  messageId: string
): Promise<P2PMessage | null> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata) return null;

  for (let pageNum: number = metadata.latestPage; pageNum >= 0; pageNum--) {
    const page: MessagePage | null = await tryLoadMessagePage(peerCid, pageNum);
    const found: P2PMessage | undefined = page?.messages.find((m) => m.id === messageId);
    if (found) return found;
  }

  return null;
}

/**
 * Stored messages from this peer still marked 'delivered' — i.e. unread.
 *
 * Bounded by the metadata's own `unreadCount`: unread messages are recent, and
 * without a bound this would read every page of a long conversation on every
 * open. Reading newest-first means the bound is reached almost immediately in
 * the normal case.
 */
export async function findUnreadFromPeer(peerCid: bigint): Promise<P2PMessage[]> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata || metadata.unreadCount <= 0) return [];

  const found: P2PMessage[] = [];
  for (let pageNum: number = metadata.latestPage; pageNum >= 0 && found.length < metadata.unreadCount; pageNum--) {
    const page: MessagePage | null = await tryLoadMessagePage(peerCid, pageNum);
    if (!page) continue;
    for (let i: number = page.messages.length - 1; i >= 0 && found.length < metadata.unreadCount; i--) {
      const m: P2PMessage = page.messages[i];
      if (m.senderCid === peerCid && m.status === 'delivered') found.push(m);
    }
  }
  return found;
}

export async function updateMessageInPages(
  peerCid: bigint,
  messageId: string,
  updates: Partial<P2PMessage>
): Promise<boolean> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata) return false;

  for (let pageNum: number = metadata.latestPage; pageNum >= 0; pageNum--) {
    const page: MessagePage | null = await tryLoadMessagePage(peerCid, pageNum);
    if (!page) continue;

    const msgIndex: number = page.messages.findIndex((m) => m.id === messageId);
    if (msgIndex !== -1) {
      page.messages[msgIndex] = { ...page.messages[msgIndex], ...updates };
      await saveMessagePage(peerCid, pageNum, page);
      return true;
    }
  }

  return false;
}

/**
 * Remove a message from the page that holds it.
 *
 * The counterpart to `updateMessageInPages`, which had no counterpart: a
 * retraction removed the message from the in-memory conversation and from the
 * screen, while the page a reload reads kept it. `deleteConversationPages` is
 * not this -- it drops the whole conversation.
 *
 * `totalMessageCount` is decremented because it is shown to the user as the
 * conversation's message count. `lastMessageIndex` is deliberately NOT touched:
 * it is a monotonic append cursor, and moving it backwards makes the next sent
 * message reuse an index that a peer has already seen.
 */
export async function removeMessageFromPages(
  peerCid: bigint,
  messageId: string
): Promise<boolean> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata) return false;

  for (let pageNum: number = metadata.latestPage; pageNum >= 0; pageNum--) {
    const page: MessagePage | null = await tryLoadMessagePage(peerCid, pageNum);
    if (!page) continue;

    const remaining: P2PMessage[] = page.messages.filter((m) => m.id !== messageId);
    if (remaining.length === page.messages.length) continue;

    page.messages = remaining;
    await saveMessagePage(peerCid, pageNum, page);
    metadata.totalMessageCount = Math.max(0, metadata.totalMessageCount - 1);
    metadata.lastUpdated = Date.now();
    await saveMetadata(peerCid, metadata);
    return true;
  }

  return false;
}

export async function updatePeerUsernameInMetadata(
  peerCid: bigint,
  username: string
): Promise<void> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata) return;
  metadata.peerUsername = username;
  metadata.lastUpdated = Date.now();
  await saveMetadata(peerCid, metadata);
}

export async function updateUnreadCount(peerCid: bigint, unreadCount: number): Promise<void> {
  const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
  if (!metadata) return;
  metadata.unreadCount = unreadCount;
  metadata.lastUpdated = Date.now();
  await saveMetadata(peerCid, metadata);
}
