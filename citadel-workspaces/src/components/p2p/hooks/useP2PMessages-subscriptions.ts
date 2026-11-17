/**
 * Event subscription wiring for useP2PMessages.
 *
 * Owns the fan-in from the conversation's transport into the hook's state: arrivals, status
 * changes, edits, deletions, clears and expiry from the history port; typing, connection and
 * presence from the status port; and the counterpart's acceptance. The transport has already
 * scoped every event to this conversation (lib/chat/transport), so nothing here filters by peer.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { PeerPresence } from '@/lib/p2p';
import { readableNow } from './useP2PMessages-read-gate';
import { debugLog } from '@/lib/debug-config';
import { retained } from '@/lib/p2p/retention';
import type { ChatMessage, ChatTransport, HistoryEvent, StatusChange } from '@/lib/chat/transport/chat-transport';

export interface ConversationSubscriptionParams {
  transport: ChatTransport;
  activeTabIdRef: React.RefObject<string>;
  /** Whether the reader is at the bottom of the chat (see useStickToBottom). */
  pinnedRef: { readonly current: boolean };
  onUnreadMessage: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setTyping: Dispatch<SetStateAction<readonly string[]>>;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  setPeerPresence: Dispatch<SetStateAction<PeerPresence | null>>;
  setIsRegistered: Dispatch<SetStateAction<boolean>>;
}

const appended = (prev: ChatMessage[], message: ChatMessage): ChatMessage[] =>
  prev.some((m: ChatMessage): boolean => m.id === message.id) ? prev : [...prev, message].sort((a, b) => a.timestamp - b.timestamp);

const holds = (prev: readonly ChatMessage[], id: string): boolean => prev.some((m: ChatMessage): boolean => m.id === id);

/** The local copy becomes the transport's; if the transport's copy is already shown, the local one goes. */
const replaced = (prev: ChatMessage[], localId: string, message: ChatMessage): ChatMessage[] => {
  if (!prev.some((m: ChatMessage): boolean => m.id === localId)) return appended(prev, message);
  const shown: boolean = prev.some((m: ChatMessage): boolean => m.id === message.id);
  return shown
    ? prev.filter((m: ChatMessage): boolean => m.id !== localId)
    : prev.map((m: ChatMessage): ChatMessage => (m.id === localId ? message : m));
};

/** Wires every conversation-scoped listener; returns one combined unsubscribe. */
export function subscribeToConversationEvents({
  transport,
  activeTabIdRef,
  pinnedRef,
  onUnreadMessage,
  setMessages,
  setTyping,
  setIsConnected,
  setPeerPresence,
  setIsRegistered,
}: ConversationSubscriptionParams): () => void {
  const onHistory = (event: HistoryEvent): void => {
    switch (event.kind) {
      case 'arrived':
        setMessages((prev: ChatMessage[]): ChatMessage[] => appended(prev, event.message));
        if (!event.incoming) return;
        if (activeTabIdRef.current !== 'messages') onUnreadMessage();
        if (readableNow(activeTabIdRef, pinnedRef)) {
          transport.history.markRead([event.message.id]).catch((err: unknown) => debugLog('UseP2PMessages', 'Error:', err));
        }
        return;
      case 'recorded':
        setMessages((prev: ChatMessage[]): ChatMessage[] => appended(prev, event.message));
        return;
      case 'status':
        setMessages((prev: ChatMessage[]): ChatMessage[] => {
          // `prev.map` always allocates, so this changed the array identity for a status
          // transition in ANY conversation -- and the chat's scroll effect keys on `messages`,
          // so every sent/delivered/read anywhere threw a reader who had scrolled up back down.
          if (!holds(prev, event.messageId)) return prev;
          return prev.map((m: ChatMessage): ChatMessage => (m.id === event.messageId ? { ...m, status: event.status } : m));
        });
        return;
      // Like 'status': a message this view does not hold changes nothing, so the array is kept.
      case 'updated':
        setMessages((prev: ChatMessage[]): ChatMessage[] => (holds(prev, event.message.id)
          ? prev.map((m: ChatMessage): ChatMessage => (m.id === event.message.id ? { ...m, ...event.message } : m))
          : prev));
        return;
      // Deletion removes the message rather than tombstoning it, matching group chat.
      case 'removed':
        setMessages((prev: ChatMessage[]): ChatMessage[] => (holds(prev, event.messageId) ? prev.filter((m: ChatMessage): boolean => m.id !== event.messageId) : prev));
        return;
      case 'replaced':
        setMessages((prev: ChatMessage[]): ChatMessage[] => replaced(prev, event.localId, event.message));
        return;
      case 'cleared':
        setMessages((prev: ChatMessage[]): ChatMessage[] => (prev.length === 0 ? prev : []));
        return;
      // Retention removed messages older than the cutoff from storage; the open view drops them too.
      case 'expired':
        setMessages((prev: ChatMessage[]): ChatMessage[] => {
          const kept: ChatMessage[] = retained(prev, event.cutoff);
          return kept.length === prev.length ? prev : kept;
        });
        return;
    }
  };

  const onStatus = (change: StatusChange): void => {
    switch (change.kind) {
      case 'typing': setTyping(change.typing); return;
      case 'connected': setIsConnected(change.connected); return;
      case 'presence': setPeerPresence(change.presence); return;
    }
  };

  const stops: (() => void)[] = [
    transport.history.subscribe(onHistory),
    transport.status?.subscribe(onStatus) ?? ((): void => undefined),
    transport.status?.acceptance?.onAccepted((): void => setIsRegistered(true)) ?? ((): void => undefined),
  ];
  return (): void => { for (const stop of stops) stop(); };
}
