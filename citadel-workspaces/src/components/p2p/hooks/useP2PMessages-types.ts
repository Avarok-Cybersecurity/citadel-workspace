/**
 * Types and helpers for useP2PMessages hook.
 */

import type { PeerPresence } from '@/lib/p2p';
import { mergeById } from '@/lib/p2p/merge-by-id';
import type { ChatMessage, ChatTransport } from '@/lib/chat/transport/chat-transport';

export interface UseP2PMessagesProps {
  transport: ChatTransport;
  activeTabIdRef: React.MutableRefObject<string>;
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Whether the reader is at the bottom; arrivals are read only while it is true. */
  pinnedRef: React.MutableRefObject<boolean>;
  onUnreadMessage: () => void;
}

export interface UseP2PMessagesReturn {
  messages: ChatMessage[];
  /** Who is typing now, by name; empty when nobody is. */
  typing: readonly string[];
  peerPresence: PeerPresence | null;
  isConnected: boolean;
  isRegistered: boolean;
  isLoadingMore: boolean;
  /**
   * True until this conversation's stored history has been read.
   *
   * Distinct from `isLoadingMore`, which is pagination: without it the empty state rendered
   * from the moment a conversation opened, so "No messages yet" printed over real history.
   */
  isLoadingHistory: boolean;
  hasMorePages: boolean;
  /** Why the last older page could not be read; null when it could, or before any was asked for. */
  olderPagesError: string | null;
  /**
   * Reads the next older page. Not only from a scroll near the top: a newest page too short
   * to overflow the view gives no scroll event, and nothing else reached the older pages.
   */
  loadOlderMessages: () => Promise<void>;
  handleScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  handleRetryMessage: (message: Pick<ChatMessage, 'id' | 'status'>) => Promise<void>;
  handleEditMessage: (messageId: string, content: string) => Promise<void>;
  handleDeleteMessage: (messageId: string) => Promise<void>;
  /** Toggle the viewer's own reaction; failures are reported, not thrown. */
  handleReactMessage: (messageId: string, emoji: string) => void;
}

/**
 * New arrivals merged into what is already rendered.
 *
 * The EXISTING copy wins a duplicate id, and the previous array reference is
 * returned when nothing new arrived — React re-renders on reference inequality,
 * and without that a thread re-sorts on every keystroke.
 *
 * The winner is passed explicitly because the messaging adapter's merge
 * resolves the same conflict the other way (in-memory beats storage), and the
 * two used to share a name and disagree silently.
 */
export function mergeMessages<M extends { id: string; timestamp: number }>(existing: M[], incoming: M[]): M[] {
  return mergeById(existing, incoming, 'existing');
}

/**
 * Prepends older messages to existing messages (for pagination), deduplicating by id.
 * Returns the previous array reference if no new messages were added.
 */
export function prependMessages<M extends { id: string; timestamp: number }>(existing: M[], older: readonly M[]): M[] {
  const existingIds: Set<string> = new Set(existing.map(m => m.id));
  const newMessages: M[] = older.filter(m => !existingIds.has(m.id));
  if (newMessages.length === 0) return existing;
  return [...newMessages, ...existing].sort((a, b) => a.timestamp - b.timestamp);
}
