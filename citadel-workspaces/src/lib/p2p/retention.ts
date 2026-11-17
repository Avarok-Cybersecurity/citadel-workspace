/**
 * Deleting a conversation's stored messages older than a cutoff.
 *
 * The store is the local agent's LocalDB on this device (see
 * message-pagination-store), so this removes this device's copy only: the peer
 * keeps theirs. No delete is sent to them.
 *
 * Every page is read, not just the leading ones: a message that arrives late
 * (an offline delivery) is appended to the NEWEST page with its original,
 * older timestamp, so "pages are oldest-first" does not bound where an old
 * message can be. The metadata's `oldestMessageTimestamp` is what makes the
 * common case cheap: nothing older than the cutoff means nothing is read.
 */
import type { ConversationMetadata, MessagePage, P2PMessage } from './p2p-types';
import type { Retention } from './chat-advanced-settings';

const DAY_MS: number = 24 * 60 * 60 * 1000;

/** Emitted with the cutoff after a chat's messages older than it were removed. */
export const MESSAGES_EXPIRED_EVENT: 'p2p:messages-expired' = 'p2p:messages-expired';
export interface MessagesExpired { peerCid: bigint; cutoff: number }

/** How the stored conversation is read and written; the agent's LocalDB in production. */
export interface RetentionPageIO {
  loadMetadata(peerCid: bigint): Promise<ConversationMetadata | null>;
  loadPage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null>;
  savePage(peerCid: bigint, pageNumber: number, page: MessagePage): Promise<void>;
  saveMetadata(peerCid: bigint, metadata: ConversationMetadata): Promise<void>;
}

/** The moment the retention period began, or null when every message is kept. */
export function retentionCutoff(now: number, retention: Retention): number | null {
  return retention === 'forever' ? null : now - retention * DAY_MS;
}

/** The messages a cutoff keeps. Shared by the store and the views over it. */
export function retained<T extends Pick<P2PMessage, 'timestamp'>>(messages: readonly T[], cutoff: number): T[] {
  return messages.filter((m: T): boolean => m.timestamp >= cutoff);
}

/** Remove every stored message older than `cutoff`; answers how many were removed. */
export async function pruneOlderThan(io: RetentionPageIO, peerCid: bigint, cutoff: number): Promise<number> {
  const metadata: ConversationMetadata | null = await io.loadMetadata(peerCid);
  if (!metadata || metadata.totalMessageCount === 0) return 0;
  if (metadata.oldestMessageTimestamp > 0 && metadata.oldestMessageTimestamp >= cutoff) return 0;

  let removed: number = 0;
  let oldestKept: number | null = null;
  for (let pageNumber: number = 0; pageNumber <= metadata.latestPage; pageNumber++) {
    const page: MessagePage | null = await io.loadPage(peerCid, pageNumber);
    if (!page) continue;
    const kept: P2PMessage[] = retained(page.messages, cutoff);
    for (const m of kept) oldestKept = oldestKept === null ? m.timestamp : Math.min(oldestKept, m.timestamp);
    if (kept.length === page.messages.length) continue;

    removed += page.messages.length - kept.length;
    page.messages = kept;
    page.pageTimestamps = {
      minTimestamp: kept.length > 0 ? kept[0].timestamp : 0,
      maxTimestamp: kept.length > 0 ? kept[kept.length - 1].timestamp : 0,
    };
    await io.savePage(peerCid, pageNumber, page);
  }

  if (removed === 0) return 0;
  metadata.totalMessageCount = Math.max(0, metadata.totalMessageCount - removed);
  // 0 when nothing is left: recordAppend treats the next message as the oldest.
  metadata.oldestMessageTimestamp = oldestKept ?? 0;
  metadata.lastUpdated = Date.now();
  await io.saveMetadata(peerCid, metadata);
  return removed;
}
