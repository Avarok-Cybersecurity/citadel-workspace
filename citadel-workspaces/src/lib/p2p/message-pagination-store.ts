/**
 * Message Pagination Store
 *
 * Paginated P2P message persistence into the INTERNAL SERVICE's LocalDB, NOT browser
 * IndexedDB (message-page-operations -> sendLocalDB* -> LocalDBGetKV): history needs
 * the local agent, not just this browser. Fine with no internet, empty with no agent.
 *
 * Format:
 *   - Metadata: msgs_with_peer_{CID}_metadata
 *   - Pages: msgs_with_peer_{CID}_{pageNumber}
 * Page 0 = oldest messages, higher pages = newer messages. The writer for agents BEFORE 0.8.6
 * only: a 0.8.6 agent writes these records itself, and refuses a window that tries (store-switch.ts).
 */

import { websocketService } from '../websocket-service';
import { loadAllMetadata } from './load-all-metadata';
import type {
  ConversationMetadata,
  MessagePage,
  P2PMessage,
} from './p2p-types';
import { MESSAGES_PER_PAGE } from './p2p-types';
import {
  findMessageInPages,
  findUnreadFromPeer,
  updateMessageInPages,
  removeMessageFromPages,
  updatePeerUsernameInMetadata,
  updateUnreadCount,
} from './message-metadata-mutations';
import {
  loadMetadata,
  tryLoadMetadata,
  saveMetadata,
  loadMessagePage,
  tryLoadMessagePage,
  saveMessagePage,
} from './message-page-operations';
import { deleteConversationPages, type DeleteScope } from './message-page-delete';
import { debugLog } from '@/lib/debug-config';
import { withPeerLock } from './peer-write-lock';
import { reviseMessageInPages, type PageRevision, type StoredRevisionOutcome } from './message-page-revision';
import { reactToMessageInPages, type StoredReactionOutcome } from './message-page-reaction';
import type { ReactionChange } from '@/lib/reactions/reaction-state';
import { placeInPage, recordAppend } from './message-page-append';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { switchedStore } from './store-switch';

export class MessagePaginationStore {
  private readonly dbPrefix: "p2p_messages" = 'p2p_messages';

  public async deleteOldFormat(): Promise<void> {
    try {
      const key: string = `${this.dbPrefix}_conversations`;
      await websocketService.sendLocalDBDelete(0n, key);
      debugLog('MessagePaginationStore', '[P2P] Deleted old monolithic format');
    } catch (error) {
      if (!isGenuinelyAbsent(error)) {
        debugLog('MessagePaginationStore', 'Failed to delete old format:', error);
      }
    }
  }

  public async loadAllMetadata(): Promise<ConversationMetadata[]> {
    return loadAllMetadata();
  }

  public async loadMetadata(peerCid: bigint): Promise<ConversationMetadata | null> {
    return loadMetadata(peerCid);
  }

  public async saveMetadata(peerCid: bigint, metadata: ConversationMetadata): Promise<void> {
    return saveMetadata(peerCid, metadata);
  }

  public async loadMessagePage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null> {
    return loadMessagePage(peerCid, pageNumber);
  }

  public async saveMessagePage(peerCid: bigint, pageNumber: number, page: MessagePage): Promise<void> {
    return saveMessagePage(peerCid, pageNumber, page);
  }

  public async appendMessageToPage(
    peerCid: bigint, message: P2PMessage,
    getCurrentCid: () => Promise<bigint | null>, getPeerUsername: () => string | undefined
  ): Promise<void> {
    return withPeerLock(peerCid, () =>
      this.appendUnserialised(peerCid, message, getCurrentCid, getPeerUsername));
  }
  /**
   * Whether this id is already on the newest page or the one before it.
   *
   * See the call site for why two pages and not one, and for what that bound
   * does not cover.
   */
  private async alreadyStored(
    peerCid: bigint,
    latestPage: number,
    currentPage: MessagePage,
    messageId: string,
  ): Promise<boolean> {
    if (currentPage.messages.some((m) => m.id === messageId)) return true;
    if (latestPage === 0) return false;
    const previous: MessagePage | null = await tryLoadMessagePage(peerCid, latestPage - 1);
    return previous?.messages.some((m) => m.id === messageId) ?? false;
  }

  private async appendUnserialised(
    peerCid: bigint,
    message: P2PMessage,
    getCurrentCid: () => Promise<bigint | null>,
    getPeerUsername: () => string | undefined
  ): Promise<void> {
    let metadata: ConversationMetadata | null = await loadMetadata(peerCid);
    const isNewConversation: boolean = !metadata;

    const ownerCid: bigint | null = await getCurrentCid();

    if (!metadata) {
      metadata = {
        peerCid,
        ownerCid: ownerCid ?? undefined,
        peerUsername: getPeerUsername(),
        totalMessageCount: 0,
        oldestMessageTimestamp: message.timestamp,
        newestMessageTimestamp: message.timestamp,
        latestPage: 0,
        messagesPerPage: MESSAGES_PER_PAGE,
        unreadCount: 0,
        lastMessageIndex: 0,
        lastUpdated: Date.now()
      };
    }

    // Adopt an unstamped record the first time the account that is actually
    // using it writes to it. Attribution by USE is the only signal available —
    // the key carries no owner — and it is safe in the direction that matters:
    // it can only ever move a record from "nobody may delete this" to "one
    // specific account may".
    if (metadata.ownerCid === undefined && ownerCid !== null) {
      metadata.ownerCid = ownerCid;
    }

    let currentPage: MessagePage | null = await loadMessagePage(peerCid, metadata.latestPage);
    if (!currentPage) {
      currentPage = {
        peerCid,
        pageNumber: metadata.latestPage,
        messages: [],
        pageTimestamps: {
          minTimestamp: message.timestamp,
          maxTimestamp: message.timestamp
        }
      };
    }

    // The last gate before a duplicate becomes permanent. ILM can redeliver an
    // inbound message after a reload (its delivered-set is memory-only), and the
    // upstream in-memory dedup cannot see it — that window is capped at 100 and
    // comes back EMPTY after a reload. A blind push wrote two copies into one
    // page, and the render-side merge dedups ACROSS batches but not within one,
    // so the pair rendered twice for ever.
    //
    // BEFORE the rollover below, not after. Rolling over replaces `currentPage`
    // with a fresh empty one, so a duplicate arriving exactly as a page filled
    // was compared against nothing and written into the new page while its twin
    // sat on the page that had just been closed.
    //
    // And against the previous page as well: the redelivery window is whatever
    // ILM still holds in its persisted inbound map at restart, which does not
    // have to fall inside the newest 50. Two pages is a bound, not a proof —
    // a redelivery older than that is still stored twice, which is no worse
    // than before and is stated here rather than assumed away.
    if (await this.alreadyStored(peerCid, metadata.latestPage, currentPage, message.id)) {
      debugLog('MessagePaginationStore', `[P2P] Skipping duplicate message ${message.id}`);
      return;
    }

    if (currentPage.messages.length >= MESSAGES_PER_PAGE) {
      await saveMessagePage(peerCid, metadata.latestPage, currentPage);

      metadata.latestPage++;
      currentPage = {
        peerCid,
        pageNumber: metadata.latestPage,
        messages: [],
        pageTimestamps: {
          minTimestamp: message.timestamp,
          maxTimestamp: message.timestamp
        }
      };
      debugLog('MessagePaginationStore', `[P2P] Created new page ${metadata.latestPage} for peer ${peerCid.toString().slice(0, 8)}...`);
    }

    placeInPage(currentPage, message);
    recordAppend(metadata, message, isNewConversation, await getCurrentCid());

    // Page first, pointer last: two round-trips, no transaction, and
    // `latestPage` is the only pointer to the page.
    await saveMessagePage(peerCid, metadata.latestPage, currentPage);
    await saveMetadata(peerCid, metadata);
  }

  public async loadLatestMessages(peerCid: bigint): Promise<P2PMessage[]> {
    const metadata: ConversationMetadata | null = await tryLoadMetadata(peerCid);
    if (!metadata) return [];

    const latestPage: MessagePage | null = await tryLoadMessagePage(peerCid, metadata.latestPage);
    return latestPage?.messages || [];
  }

  public async findUnreadFromPeer(peerCid: bigint): Promise<P2PMessage[]> {
    return findUnreadFromPeer(peerCid);
  }

  public async findMessageInPages(peerCid: bigint, messageId: string): Promise<P2PMessage | null> {
    return findMessageInPages(peerCid, messageId);
  }

  public async updateMessageInPages(peerCid: bigint, messageId: string, updates: Partial<P2PMessage>): Promise<boolean> {
    return withPeerLock(peerCid, () => updateMessageInPages(peerCid, messageId, updates));
  }

  public async reactToMessageInPages(peerCid: bigint, messageId: string, change: ReactionChange): Promise<StoredReactionOutcome> {
    return withPeerLock(peerCid, () => reactToMessageInPages(peerCid, messageId, change));
  }

  public async reviseMessageInPages(peerCid: bigint, messageId: string, reviserCid: bigint, revision: PageRevision): Promise<StoredRevisionOutcome> {
    return withPeerLock(peerCid, () => reviseMessageInPages(peerCid, messageId, reviserCid, revision));
  }

  public async removeMessageFromPages(peerCid: bigint, messageId: string): Promise<boolean> {
    return withPeerLock(peerCid, () => removeMessageFromPages(peerCid, messageId));
  }

  public async updatePeerUsernameInMetadata(peerCid: bigint, username: string): Promise<void> {
    return withPeerLock(peerCid, () => updatePeerUsernameInMetadata(peerCid, username));
  }

  public async updateUnreadCount(peerCid: bigint, unreadCount: number): Promise<void> {
    return withPeerLock(peerCid, () => updateUnreadCount(peerCid, unreadCount));
  }
  public async deleteConversationPages(peerCid: bigint, scope: DeleteScope): Promise<void> {
    return deleteConversationPages(peerCid, scope);
  }
}

// Browser-written only for an agent before 0.8.6; otherwise the agent (store-switch.ts).
export const messagePaginationStore: MessagePaginationStore = switchedStore(new MessagePaginationStore());
