/**
 * Conversation Manager
 *
 * Manages P2P conversation state in memory and coordinates with storage.
 */

import { MessagingLayerType } from '@/types/messaging-layer';
import { initialPresence } from './initial-presence';
import { shownPresence } from '../presence';
import { p2pAutoConnectService } from '../p2p-auto-connect-service';
import { eventEmitter } from '../event-emitter';
import type { P2PMessage, P2PConversation, MessageCache } from './p2p-types';
import { messagePaginationStore } from './message-pagination-store';
import { debugLog } from '@/lib/debug-config';
import { clearSessionState } from './reset-conversations';
import { holdMessage } from './conversation-memory';
import type { ConversationMetadata } from '@/lib/p2p/p2p-types';

export interface ConversationManagerConfig {
  /** Function to get current CID */
  getCurrentCid: () => Promise<bigint | null>;
  /** Max messages to keep in memory per conversation */
  maxMessagesPerConversation: number;
  /** Max messages in global queue */
  maxQueueSize: number;
}

export class ConversationManager {
  private readonly cache: MessageCache;
  private readonly connections: Map<bigint, boolean> = new Map();
  private readonly config: ConversationManagerConfig;

  constructor(config: ConversationManagerConfig) {
    this.config = config;
    this.cache = {
      conversations: new Map(),
      messageQueue: [],
      maxQueueSize: config.maxQueueSize,
      maxMessagesPerConversation: config.maxMessagesPerConversation
    };
  }

  /** Forget everything held for the outgoing account. See reset-conversations.ts. */
  public clearForSessionChange(): void {
    clearSessionState(this.cache, this.connections);
  }

  public getConversationsMap(): Map<bigint, P2PConversation> {
    return this.cache.conversations;
  }

  public getConnections(): Map<bigint, boolean> {
    return this.connections;
  }

  public setConnection(peerCid: bigint, connected: boolean): void {
    this.connections.set(peerCid, connected);
  }

  public isConnected(peerCid: bigint): boolean {
    return this.connections.get(peerCid) || false;
  }

  public getOrCreateConversation(peerCid: bigint, peerUsername?: string): P2PConversation {
    let conversation: P2PConversation | undefined = this.cache.conversations.get(peerCid);
    if (!conversation) {
      const isConnectedLocal: boolean = this.connections.get(peerCid) === true;

      conversation = {
        peerCid,
        peerUsername,
        messages: [],
        lastMessageIndex: 0,
        unreadCount: 0,
        typing: false,
        lastTypingUpdate: 0,
        presence: initialPresence(isConnectedLocal, shownPresence(peerUsername, peerCid, p2pAutoConnectService.peerOnlineStatus(peerCid)))
      };
      this.cache.conversations.set(peerCid, conversation);
    } else if (peerUsername && !conversation.peerUsername) {
      conversation.peerUsername = peerUsername;
    }
    return conversation;
  }

  public async addMessageToConversation(peerCid: bigint, message: P2PMessage): Promise<boolean> {
    if (!(await this.holdInMemory(peerCid, message))) return false;
    await messagePaginationStore.appendMessageToPage(
      peerCid,
      message,
      () => this.config.getCurrentCid(),
      () => this.cache.conversations.get(peerCid)?.peerUsername
    );
    return true;
  }

  /** The window half alone: for a message the agent has already stored. */
  public async holdInMemory(peerCid: bigint, message: P2PMessage): Promise<boolean> {
    const conversation: P2PConversation = this.getOrCreateConversation(peerCid);
    if (!holdMessage(this.cache, conversation, message)) return false;

    // The badge every sidebar reads lives on the in-memory conversation, and
    // nothing incremented it -- only resets and decrements existed. So a message
    // arriving in a conversation the user does not have open produced no badge
    // at all until the next reload, when loadFromStorage copies the persisted
    // metadata count in. The persisted side has always incremented (see
    // message-page-append); this is the half that was never wired.
    //
    // Same predicate as the persisted side, deliberately: an own message is not
    // unread, and a message that has not been delivered is not yet news.
    const currentCid: bigint | null = await this.config.getCurrentCid();
    if (message.senderCid !== currentCid && message.status === 'delivered') {
      conversation.unreadCount += 1;
    }
    return true;
  }

  public getConversation(peerCid: bigint): P2PConversation | undefined {
    return this.cache.conversations.get(peerCid);
  }

  public getAllConversations(): P2PConversation[] {
    return Array.from(this.cache.conversations.values());
  }

  public getRecentMessages(limit: number = 50): P2PMessage[] {
    return this.cache.messageQueue.slice(-limit);
  }

  public setPeerUsername(peerCid: bigint, username: string): void {
    const conversation: P2PConversation | undefined = this.cache.conversations.get(peerCid);
    if (conversation) {
      conversation.peerUsername = username;
      void messagePaginationStore.updatePeerUsernameInMetadata(peerCid, username);
    }
  }

  /**
   * Drop every message held for one peer, keeping the conversation itself so
   * the thread stays in the list and can receive new messages.
   *
   * Paired with messagePaginationStore.deleteConversationPages: clearing only
   * the persisted pages leaves the cache populated, so the open chat keeps
   * showing everything until a reload — which reads as "the button did
   * nothing".
   */
  public clearMessages(peerCid: bigint): void {
    const conversation: P2PConversation | undefined = this.cache.conversations.get(peerCid);
    if (!conversation) return;
    conversation.messages = [];
    conversation.lastMessageIndex = 0;
    conversation.unreadCount = 0;
  }

  public async cleanupStaleConversations(validPeerCids: Set<bigint>): Promise<number> {
    // An empty set never legitimately means "delete everything". A user with
    // no peers has no conversations either, so refusing costs nothing — while
    // proceeding deletes the persisted pages of EVERY cached conversation.
    //
    // That is reachable in normal use: the caller builds this set from
    // ListRegisteredPeers, which the hook's own comment records as timing out
    // intermittently under concurrent P2P activity, and the guard there is
    // `startupCompleteRef`, which initialises to true — so a plain reload is
    // not covered. The guard belongs here, at the destructive operation,
    // rather than at the one caller that happens to exist today.
    if (validPeerCids.size === 0) {
      debugLog('ConversationManager', '[P2P] Refusing stale-conversation cleanup: the valid peer set is empty');
      return 0;
    }

    const staleCids: bigint[] = [];
    const currentCid: bigint | null = await this.config.getCurrentCid();

    for (const [peerCid] of this.cache.conversations.entries()) {
      if (currentCid && peerCid === currentCid) continue;
      if (!validPeerCids.has(peerCid)) staleCids.push(peerCid);
    }

    for (const cid of staleCids) {
      debugLog('ConversationManager', `[P2P] Removing stale conversation for peer: ${cid.toString().slice(0, 8)}...`);
      this.cache.conversations.delete(cid);
    }

    if (staleCids.length > 0) {
      debugLog('ConversationManager', `[P2P] Cleaned up ${staleCids.length} stale conversation(s)`);
      // currentCid is the proof of ownership: deleteConversationPages refuses
      // any record it cannot attribute to this account. Without it, one user
      // logging in deleted every other user's history on the device.
      await Promise.all(
        staleCids.map((cid) => messagePaginationStore.deleteConversationPages(cid, {
          ownerCid: currentCid,
          includeUnattributed: false,
        }))
      );
      eventEmitter.emit('p2p:conversations-cleaned');
    }

    return staleCids.length;
  }

  /**
   * Initialize conversations from persisted metadata
   */
  public async loadFromStorage(): Promise<void> {
    try {
      await messagePaginationStore.deleteOldFormat();
      const metadataList: ConversationMetadata[] = await messagePaginationStore.loadAllMetadata();

      for (const metadata of metadataList) {
        this.cache.conversations.set(metadata.peerCid, {
          peerCid: metadata.peerCid,
          peerUsername: metadata.peerUsername,
          messages: [],
          lastMessageIndex: metadata.lastMessageIndex,
          unreadCount: metadata.unreadCount,
          typing: false,
          lastTypingUpdate: 0,
          presence: { status: MessagingLayerType.Offline, lastUpdate: 0 }
        });
      }
    } catch (error) {
      debugLog('ConversationManager', 'Failed to load cached messages:', error);
    }
  }
}
