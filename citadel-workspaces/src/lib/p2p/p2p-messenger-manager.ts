/**
 * P2P Messenger Manager
 *
 * Orchestrates P2P messaging by delegating to specialized modules:
 * - ConversationManager: Conversation state management
 * - MessageHandler: Incoming message processing
 * - MessageSender: Outgoing message sending
 * - PresenceManager: Presence and typing indicators
 * - CheckStateManager: CheckState handshake protocol
 * - MessagePaginationStore: IndexedDB persistence
 */

import type { MessagingLayer } from '@/types/messaging-layer';
import { notifyEach } from '@/lib/notify-listeners';
import { markP2PMessageHandlerAttached } from './p2p-handler-ready';
import { editMessage, deleteMessage, reactToMessage, markMessagesAsRead } from './messenger-routing';
import { bindAgentConversations, type AgentBindings } from '../agent-conversations/bind-agent-conversations';
import { notifyMessageArrived, type ArrivalNotice } from './message-arrival-notification';
import { websocketService } from '../websocket-service';
import { notificationService, type Notification as AppNotification } from '../notification-service';
import { EventListenerManager } from '../utils/event-listener-manager';
import type { InternalServiceResponse } from 'citadel-workspace-client-ts';
import type { P2PMessage, P2PConversation, PeerPresence } from './p2p-types';
import { messagePaginationStore } from './message-pagination-store';
import { PresenceManager } from './presence-manager';
import { CheckStateManager } from './checkstate-manager';
import { MessageHandler } from './message-handler';
import { MessageSender } from './message-sender';
import type { SendMessageOptions } from './message-sender-types';
import { ConversationManager } from './conversation-manager';
import { bindConversationSessionReset, bindCachedMessageLoad } from './reset-conversations';
import { bindVisibilityFlush } from './visibility-flush';
import { clearConversationHistory } from './clear-conversation-history';
import { resolveCurrentCid, updatePeerPresenceOnConnect } from './messenger-cid-resolver';
import { bindPeerConnectionState } from './bind-peer-connection-state';
import { syncConnectionsFromBackend, updateFileTransferState, updateUnreadCount, autoRegisterPeer } from './messenger-compatibility';
import { bindOutgoingFileOffers } from './record-outgoing-file-transfer';
import { bindChatDocumentInbox } from './chat-document-inbox';
import { debugLog, errorLog } from '@/lib/debug-config';
import { conversationInFront } from '@/lib/notification-service/in-front';
import { TIMEOUT } from '../timeout-constants';
import type { MessagePage, ConversationMetadata } from '@/lib/p2p/p2p-types';

export class P2PMessengerManager extends EventListenerManager {
  private static instance: P2PMessengerManager;
  private messageListeners: ((message: P2PMessage) => void)[] = [];
  private messageStatusListeners: ((messageId: string, status: P2PMessage['status']) => void)[] = [];
  private connectionListeners: ((peerCid: bigint, connected: boolean) => void)[] = [];
  private initPromise: Promise<void> | null = null;
  private isReady: boolean = false;
  private cachedMessagesLoaded: boolean = false;
  private activeConversationPeerCid: bigint | null = null;
  private readonly conversationManager: ConversationManager;
  private readonly presenceManager: PresenceManager;
  private readonly checkStateManager: CheckStateManager;
  private readonly messageHandler: MessageHandler;
  private readonly messageSender: MessageSender;
  private readonly agent: AgentBindings;

  private constructor() {
    super();
    this.conversationManager = new ConversationManager({ getCurrentCid: (): Promise<bigint | null> => resolveCurrentCid(), maxMessagesPerConversation: 100, maxQueueSize: 100 });
    const cm: ConversationManager = this.conversationManager;
    // The toast for a message that arrived elsewhere: the browser path and the agent's events share it.
    const arrival: ArrivalNotice = {
      shouldShowNotification: (peerCid): boolean => !conversationInFront(this.activeConversationPeerCid === peerCid),
      getConversations: (): Map<bigint, P2PConversation> => cm.getConversationsMap(),
      addNotification: (title, body, senderId, messageId, recipientCid, options): AppNotification =>
        notificationService.addMessageNotification(title, body, senderId, messageId, recipientCid, options),
    };
    this.agent = bindAgentConversations((e, h) => this.listen(e, h), { ownCid: resolveCurrentCid, getOrCreateConversation: (p, u) => cm.getOrCreateConversation(p, u), holdInMemory: (p, m) => cm.holdInMemory(p, m), clearMessages: (p) => cm.clearMessages(p), notifyMessage: (m) => notifyEach(this.messageListeners, 'p2p message', m), notifyStatus: (id, st) => notifyEach(this.messageStatusListeners, 'p2p message status', id, st), notifyArrived: (p, m) => notifyMessageArrived(arrival, p, m), emit: (e, d) => this.emit(e, d), resync: () => this.loadCachedMessages().then(() => this.emit('p2p:messages-loaded')), peers: () => cm.getAllConversations().map((c) => c.peerCid), activePeer: () => this.activeConversationPeerCid, findMessage: async (p, id) => cm.getConversation(p)?.messages.find((m) => m.id === id) ?? messagePaginationStore.findMessageInPages(p, id) });
    this.presenceManager = new PresenceManager({
      sendCommand: (peerCid, layer): Promise<void> => this.messageSender.sendRawMessage(peerCid, layer),
      getConnectedPeers: (): bigint[] => Array.from(this.conversationManager.getConnections().entries()).filter(([, c]) => c).map(([p]): bigint => p)
    });
    this.checkStateManager = new CheckStateManager({
      timeout: TIMEOUT.CHECKSTATE_MS,
      sendToP2P: (peerCid, bytes, compressionHint): Promise<void> => this.messageSender.sendRawBytes(peerCid, bytes, compressionHint),
      getCurrentCid: (): Promise<bigint | null> => resolveCurrentCid(),
      getLastMessageIndex: (peerCid): number => this.conversationManager.getOrCreateConversation(peerCid).lastMessageIndex
    });
    this.messageSender = new MessageSender({
      getCurrentCid: (): Promise<bigint | null> => resolveCurrentCid(),
      getOrCreateConversation: (peerCid): P2PConversation => this.conversationManager.getOrCreateConversation(peerCid),
      addMessageToConversation: (peerCid, message): Promise<boolean> => this.conversationManager.addMessageToConversation(peerCid, message),
      findStoredMessage: (p, id): Promise<P2PMessage | null> => messagePaginationStore.findMessageInPages(p, id),
      agent: (): AgentBindings => this.agent,
      updateMessageInPages: (peerCid, messageId, updates): Promise<boolean> => messagePaginationStore.updateMessageInPages(peerCid, messageId, updates),
      emitEvent: (event, data): void => this.emit(event, data),
      notifyMessageListeners: (message): void => notifyEach(this.messageListeners, 'p2p message', message),
      notifyMessageStatusListeners: (messageId, status): void => notifyEach(this.messageStatusListeners, 'p2p message status', messageId, status),
      isConnected: (peerCid): boolean => this.conversationManager.isConnected(peerCid),
      tryEnsurePeerReady: (peerCid): Promise<boolean> => this.checkStateManager.tryEnsurePeerReady(peerCid)
    });
    this.messageHandler = new MessageHandler({
      getCurrentCid: (): Promise<bigint | null> => resolveCurrentCid(),
      isConnected: (peerCid): boolean => this.conversationManager.isConnected(peerCid),
      getOrCreateConversation: (peerCid): P2PConversation => this.conversationManager.getOrCreateConversation(peerCid),
      addMessageToConversation: (peerCid, message): Promise<boolean> => this.conversationManager.addMessageToConversation(peerCid, message),
      updateMessageInPages: (peerCid, messageId, updates): Promise<boolean> => messagePaginationStore.updateMessageInPages(peerCid, messageId, updates),
      removeMessageFromPages: (peerCid, messageId): Promise<boolean> => messagePaginationStore.removeMessageFromPages(peerCid, messageId),
      notifyMessageListeners: (message): void => notifyEach(this.messageListeners, 'p2p message', message),
      notifyMessageStatusListeners: (messageId, status): void => notifyEach(this.messageStatusListeners, 'p2p message status', messageId, status),
      notifyTypingListeners: (peerCid, isTyping): void => this.presenceManager.notifyTypingChange(peerCid, isTyping),
      notifyPresenceListeners: (peerCid, presence): void => this.presenceManager.notifyPresenceChange(peerCid, presence),
      sendMessageAck: (messageId, ackType, peerCid, recipientCid): Promise<void> => this.messageSender.sendMessageAck(messageId, ackType, peerCid, recipientCid),
      handleCheckState: (peerCid): Promise<void> => this.checkStateManager.handleCheckState(peerCid),
      handleCheckStateResponse: (peerCid): void => this.checkStateManager.handleCheckStateResponse(peerCid),
      markPeerReady: (peerCid): void => this.checkStateManager.markPeerReady(peerCid),
      ...arrival,
    });
    this.setupEventListeners();
    // `canSendRequests`, not `isConnected`: the latter is false in every follower
    // tab for ever. This was correct today only by boot ordering -- main.tsx
    // constructs the manager before init runs, so the connection-success
    // listener below rescued followers. Any future caller constructing it later
    // would have booted them with an empty conversation history.
    if (websocketService.canSendRequests()) {
      this.initPromise = this.loadCachedMessages().then(() => { this.isReady = true; this.emit('p2p:messages-loaded'); })
        .catch(err => debugLog('P2PMessengerManager', 'Loading cached messages failed:', err));
    }
  }

  public static getInstance(): P2PMessengerManager {
    if (!P2PMessengerManager.instance) { P2PMessengerManager.instance = new P2PMessengerManager(); }
    return P2PMessengerManager.instance;
  }
  public async waitForReady(): Promise<void> { if (this.isReady) return; if (this.initPromise) await this.initPromise; }
  protected setupEventListeners(): void {
    bindCachedMessageLoad(
      (event, handler) => this.listen(event, handler),
      () => this.cachedMessagesLoaded,
      () => this.loadCachedMessages(),
      () => { this.isReady = true; this.emit('p2p:messages-loaded'); },
    );
    bindVisibilityFlush(() => this.checkStateManager.flushPendingCheckStateResponses());
    bindChatDocumentInbox((event, handler) => this.listen(event, handler));
    bindOutgoingFileOffers((event, handler) => this.listen(event, handler), { addMessageToConversation: (p, m) => this.conversationManager.addMessageToConversation(p, m), notifyMessageListeners: (m) => notifyEach(this.messageListeners, 'p2p message', m), emitEvent: (e, d) => this.emit(e, d) });
    // See reset-conversations.ts.
    bindConversationSessionReset(
      (event, handler) => this.listen(event, handler),
      this.conversationManager,
      // `isReady` regardless — the reload finished and the cache is in a correct
      // state either way, so the UI must not sit on a spinner. But
      // `cachedMessagesLoaded` only when it really loaded, or the retry in
      // `on-ws-connection-success` above is short-circuited permanently.
      (loaded: boolean) => { this.cachedMessagesLoaded = loaded; this.isReady = true; this.emit('p2p:messages-loaded'); },
      () => { this.cachedMessagesLoaded = false; this.isReady = false; },
    );
    this.listen<InternalServiceResponse>('websocket-message', (response) => { void this.messageHandler.handleWebSocketMessage(response); });
    // Marked immediately after the subscription, not before: the inbound router
    // acks a forwarded message only once this is set, and acking before the
    // handler is attached would confirm a delivery that never happened.
    markP2PMessageHandlerAttached();
    bindPeerConnectionState((event, handler) => this.listen(event, handler), {
      conversationManager: this.conversationManager,
      presenceManager: this.presenceManager,
      emit: (e, d) => this.emit(e, d),
      notifyListeners: (peerCid, connected): void => notifyEach(this.connectionListeners, 'p2p connection', peerCid, connected),
      markReady: (peerCid) => this.checkStateManager.markPeerReady(peerCid),
      clearReady: (peerCid) => this.checkStateManager.clearPeerReadyState(peerCid),
    });
    this.listen<{ peer: { cid: bigint; username: string } }>('p2p:peer-registered', ({ peer }) => {
      if (peer.cid && peer.username) this.conversationManager.setPeerUsername(peer.cid, peer.username);
      this.flushHeldUntilRegistered(peer.cid); // here, not in a chat, so it goes whether or not the chat is open
    });
  }

  private async loadCachedMessages(): Promise<void> { await this.conversationManager.loadFromStorage(); this.cachedMessagesLoaded = true; }
  // ===== Public API: Messaging =====
  public async sendMessage(recipientCid: bigint, content: string, options?: SendMessageOptions): Promise<P2PMessage> { return this.messageSender.sendMessage(recipientCid, content, options); }
  /** A held message stays held when this fails, so it is reported rather than lost. */
  public flushHeldUntilRegistered(peerCid: bigint): void { this.messageSender.flushHeldUntilRegistered(peerCid).catch((e: unknown): void => errorLog('P2PMessenger', `Messages held for ${peerCid.toString()} did not send yet`, e)); }
  public async resendMessage(peerCid: bigint, messageId: string): Promise<void> { const c: P2PConversation | undefined = this.conversationManager.getConversation(peerCid); if (!c) throw new Error(`Conversation with ${peerCid} not found`); return this.messageSender.resendMessage(peerCid, messageId, c); }
  public async sendRawMessage(recipientCid: bigint, layer: MessagingLayer): Promise<void> { return this.messageSender.sendRawMessage(recipientCid, layer); }
  public async editMessage(peerCid: bigint, messageId: string, contents: string): Promise<void> { return editMessage(this.agent, this.conversationManager, (e, d) => this.emit(e, d), (p, l) => this.sendRawMessage(p, l), peerCid, messageId, contents); }
  public async deleteMessage(peerCid: bigint, messageId: string): Promise<void> { return deleteMessage(this.agent, this.conversationManager, (e, d) => this.emit(e, d), (p, l) => this.sendRawMessage(p, l), peerCid, messageId); }
  public async reactToMessage(peerCid: bigint, messageId: string, emoji: string): Promise<void> { return reactToMessage(this.agent, this.conversationManager, (e, d) => this.emit(e, d), (p, l) => this.sendRawMessage(p, l), peerCid, messageId, emoji); }
  public async markMessagesAsRead(peerCid: bigint, messageIds?: string[]): Promise<void> { return markMessagesAsRead(this.agent, this.conversationManager, (msgId, ackType, peer) => this.messageSender.sendMessageAck(msgId, ackType, peer), (e, d) => this.emit(e, d), peerCid, messageIds); }

  // ===== Public API: Presence =====
  public async sendPresenceUpdate(recipientCid: bigint, presence: MessagingLayer): Promise<void> { return this.presenceManager.sendPresenceUpdate(recipientCid, presence); }
  public async broadcastPresence(presence: MessagingLayer): Promise<void> { return this.presenceManager.broadcastPresence(presence); }
  public getOwnPresence(): PeerPresence { return this.presenceManager.getOwnPresence(); }
  public startTypingPolling(recipientCid: bigint, getCurrentText: () => string): void { this.presenceManager.startTypingPolling(recipientCid, getCurrentText); }
  public stopTypingPolling(recipientCid: bigint): void { this.presenceManager.stopTypingPolling(recipientCid); }
  public async sendTypingIndicator(recipientCid: bigint): Promise<void> { return this.presenceManager.sendTypingIndicator(recipientCid); }

  // ===== Public API: Conversations =====
  public getConversation(peerCid: bigint): P2PConversation | undefined { return this.conversationManager.getConversation(peerCid); }
  public getAllConversations(): P2PConversation[] { return this.conversationManager.getAllConversations(); }
  public getRecentMessages(limit: number = 50): P2PMessage[] { return this.conversationManager.getRecentMessages(limit); }
  public isConnected(peerCid: bigint): boolean { return this.conversationManager.isConnected(peerCid); }
  public setPeerUsername(peerCid: bigint, username: string): void { this.conversationManager.setPeerUsername(peerCid, username); }
  public async cleanupStaleConversations(validPeerCids: Set<bigint>): Promise<number> { return this.conversationManager.cleanupStaleConversations(validPeerCids); }

  public async clearConversationHistory(peerCid: bigint): Promise<void> { return clearConversationHistory(this.conversationManager, peerCid); }
  public async loadMessagePage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null> { return messagePaginationStore.loadMessagePage(peerCid, pageNumber); }
  public async loadLatestMessages(peerCid: bigint): Promise<P2PMessage[]> { return messagePaginationStore.loadLatestMessages(peerCid); }
  public async getConversationMetadata(peerCid: bigint): Promise<ConversationMetadata | null> { return messagePaginationStore.loadMetadata(peerCid); }

  // ===== Public API: Event Listeners =====
  public onMessage(listener: (message: P2PMessage) => void): () => void { this.messageListeners.push(listener); return () => { this.messageListeners = this.messageListeners.filter(l => l !== listener); }; }
  public onMessageStatusChange(listener: (messageId: string, status: P2PMessage['status']) => void): () => void { this.messageStatusListeners.push(listener); return () => { this.messageStatusListeners = this.messageStatusListeners.filter(l => l !== listener); }; }
  public onTyping(listener: (peerCid: bigint, isTyping: boolean) => void): () => void { return this.presenceManager.onTyping(listener); }
  public onConnectionChange(listener: (peerCid: bigint, connected: boolean) => void): () => void { this.connectionListeners.push(listener); return () => { this.connectionListeners = this.connectionListeners.filter(l => l !== listener); }; }
  public onPresenceChange(listener: (peerCid: bigint, presence: PeerPresence) => void): () => void { return this.presenceManager.onPresenceChange(listener); }
  public setActiveConversation(peerCid: bigint | null): void { this.activeConversationPeerCid = peerCid; this.agent.focusChanged(); }

  // ===== Compatibility Methods =====
  public async syncConnectionsFromBackend(): Promise<void> { return syncConnectionsFromBackend(this.conversationManager, () => resolveCurrentCid(), (peerCid) => updatePeerPresenceOnConnect(this.conversationManager, this.presenceManager, (e, d) => this.emit(e, d), peerCid)); }
  public ensurePeerReady(peerCid: bigint): Promise<void> { return this.checkStateManager.ensurePeerReady(peerCid); }
  public isPeerReady(peerCid: bigint): boolean { return this.checkStateManager.isPeerReady(peerCid); }
  public clearPeerReadyState(peerCid: bigint): void { this.checkStateManager.clearPeerReadyState(peerCid); }
  public updateFileTransferState(peerCid: bigint, transferId: string, updates: { transfer_state?: P2PMessage['transfer_state']; transfer_progress?: number }): void { updateFileTransferState(this.conversationManager, (e, d) => this.emit(e, d), peerCid, transferId, updates); }
  public markAsRead(peerCid: bigint): void { void this.markMessagesAsRead(peerCid); }
  public async updateUnreadCount(peerCid: bigint, unreadCount: number): Promise<void> { return updateUnreadCount(this.conversationManager, peerCid, unreadCount); }
  public async autoRegisterPeer(peerCid: bigint, peerUsername: string): Promise<void> { return autoRegisterPeer(() => resolveCurrentCid(), peerCid, peerUsername); }
}

// Lazy singleton — deferred to first access to avoid circular dependency TDZ.
// The constructor accesses websocketService which may not be initialized during
// module evaluation due to circular imports.
let _p2pInstance: P2PMessengerManager | null = null;
export function getP2PMessengerManager(): P2PMessengerManager {
  if (!_p2pInstance) { _p2pInstance = P2PMessengerManager.getInstance(); }
  return _p2pInstance;
}
// Backward-compatible alias (accessed lazily via Proxy for existing destructured imports).
// Both `get` and `set` delegate to the real singleton so external callers that
// assign to exposed fields write through to the real instance rather than
// silently landing on the empty placeholder target.
export const p2pMessengerManager: P2PMessengerManager = new Proxy({} as P2PMessengerManager, {
  get(_target: P2PMessengerManager, prop: string | symbol, receiver: unknown): unknown {
    return Reflect.get(getP2PMessengerManager(), prop, receiver);
  },
  set(_target: P2PMessengerManager, prop: string | symbol, value: unknown, receiver: unknown): boolean {
    return Reflect.set(getP2PMessengerManager(), prop, value, receiver);
  },
});
