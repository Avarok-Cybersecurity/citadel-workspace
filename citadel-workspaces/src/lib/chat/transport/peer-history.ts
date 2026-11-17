/**
 * A direct chat's history port: the messenger's stored pages and its live events, scoped to one
 * peer and stamped with who wrote each message.
 *
 * This is where `useP2PMessages` and its nine-listener subscription file used to reach the
 * messenger singleton and the global event emitter directly. Every filter by peer happens here,
 * so the pane only ever hears about its own conversation.
 */
import type { P2PMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import type { ConversationMetadata, MessagePage, P2PMessage } from '@/lib/p2p/p2p-types';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';
import { applyRetentionOnOpen } from '@/lib/p2p/retention-sweep';
import { MESSAGES_EXPIRED_EVENT, type MessagesExpired } from '@/lib/p2p/retention';
import { eventEmitter } from '@/lib/event-emitter';
import { notificationService } from '@/lib/notification-service';
import type { ChatAuthor, ChatMessage, ChatSelf, HistoryCursor, HistoryEvent, HistoryPage, HistoryPort } from './chat-transport';

export function peerAuthor(message: Pick<P2PMessage, 'senderCid'>, self: ChatSelf | null, peer: ChatPeer): ChatAuthor {
  if (self !== null && message.senderCid === self.cid) return { own: true, name: self.displayName, username: null };
  return { own: false, name: peer.name, username: peer.username };
}

export function authored(message: P2PMessage, self: ChatSelf | null, peer: ChatPeer): ChatMessage {
  return { ...message, author: peerAuthor(message, self, peer), share: null };
}

const withPeer = (message: Pick<P2PMessage, 'senderCid' | 'recipientCid'>, peerCid: bigint): boolean =>
  message.senderCid === peerCid || message.recipientCid === peerCid;

const olderThan = (page: number): HistoryCursor | null => (page > 0 ? { kind: 'page', page: page - 1 } : null);

export function peerHistory(messenger: P2PMessengerManager, peer: ChatPeer, self: ChatSelf | null): HistoryPort {
  const stamp = (messages: readonly P2PMessage[]): ChatMessage[] => messages.map((m: P2PMessage): ChatMessage => authored(m, self, peer));
  const cached = (): ChatMessage[] => stamp(messenger.getConversation(peer.cid)?.messages ?? []);

  return {
    loadLatest: async (): Promise<HistoryPage> => {
      await messenger.waitForReady();
      await applyRetentionOnOpen(peer.cid);
      await messenger.syncConnectionsFromBackend();
      const metadata: ConversationMetadata | null = await messenger.getConversationMetadata(peer.cid);
      if (metadata === null) return { messages: cached(), older: null };
      return { messages: stamp(await messenger.loadLatestMessages(peer.cid)), older: olderThan(metadata.latestPage) };
    },

    loadOlder: async (cursor: HistoryCursor): Promise<HistoryPage> => {
      if (cursor.kind !== 'page') throw new Error('A direct chat pages its history by page number');
      const page: MessagePage | null = await messenger.loadMessagePage(peer.cid, cursor.page);
      if (page === null || page.messages.length === 0) return { messages: [], older: null };
      return { messages: stamp(page.messages), older: olderThan(cursor.page) };
    },

    cached,

    subscribe: (listener: (event: HistoryEvent) => void): (() => void) => {
      const stops: (() => void)[] = [
        messenger.onMessage((message: P2PMessage): void => {
          if (!withPeer(message, peer.cid)) return;
          listener({ kind: 'arrived', message: authored(message, self, peer), incoming: message.senderCid === peer.cid });
        }),
        messenger.onMessageStatusChange((messageId: string, status: P2PMessage['status']): void => listener({ kind: 'status', messageId, status })),
        eventEmitter.on('p2p:message-updated', (updated: P2PMessage): void => {
          if (withPeer(updated, peer.cid)) listener({ kind: 'updated', message: updated });
        }),
        eventEmitter.on('p2p:message-deleted', ({ peerCid, messageId }: { peerCid: bigint; messageId: string }): void => {
          if (peerCid === peer.cid) listener({ kind: 'removed', messageId });
        }),
        eventEmitter.on('p2p:conversation-cleared', ({ peerCid }: { peerCid: bigint }): void => {
          if (peerCid === peer.cid) listener({ kind: 'cleared' });
        }),
        eventEmitter.on(MESSAGES_EXPIRED_EVENT, ({ peerCid, cutoff }: MessagesExpired): void => {
          if (peerCid === peer.cid) listener({ kind: 'expired', cutoff });
        }),
        // Messages recorded by other parts of the app (file transfers) emit this and not onMessage.
        eventEmitter.on('p2p:message-received', ({ peerCid, messageId, message }: { peerCid: bigint; messageId: string; message?: P2PMessage }): void => {
          if (peerCid !== peer.cid) return;
          const found: P2PMessage | undefined = message ?? messenger.getConversation(peer.cid)?.messages.find((m: P2PMessage): boolean => m.id === messageId);
          if (found) listener({ kind: 'recorded', message: authored(found, self, peer) });
        }),
      ];
      return (): void => { for (const stop of stops) stop(); };
    },

    markRead: (messageIds: readonly string[] | null): Promise<void> =>
      messenger.markMessagesAsRead(peer.cid, messageIds === null ? undefined : [...messageIds]),

    focus: (): (() => void) => {
      messenger.setActiveConversation(peer.cid);
      return (): void => { messenger.setActiveConversation(null); };
    },

    clearNotices: (): void => notificationService.markMessageNotificationsAsReadBySender(peer.cid.toString()),
  };
}

