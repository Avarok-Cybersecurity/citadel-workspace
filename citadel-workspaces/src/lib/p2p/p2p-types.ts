/**
 * P2P Messenger Types
 *
 * Interfaces and types for P2P messaging conversations, messages, and presence.
 */

import type { MessagingLayerType } from '@/types/messaging-layer';
import type {
  ConversationMessage,
  ConversationMetadata as GeneratedConversationMetadata,
  ConversationPage,
} from 'citadel-internal-service-wasm-client';

// ============================================================================
// PAGINATED MESSAGE PERSISTENCE
// ============================================================================
// Messages are stored in pages to support lazy loading and efficient storage.
// Format:
//   - Metadata: msgs_with_peer_{CID}_metadata
//   - Pages: msgs_with_peer_{CID}_{pageNumber}
// Page 0 = oldest messages, higher pages = newer messages
// ============================================================================

export const MESSAGES_PER_PAGE: number = 50;
export const PAGINATED_PREFIX: "msgs_with_peer_" = 'msgs_with_peer_';

// The conversation record types are the agent's: it is their only writer
// (multi-window mw4), so they are generated from its Rust definitions
// (citadel-internal-service-types `conversation.rs`) and only aliased here.
// Their field names are the ones these pages have always stored, so history
// written before the agent kept it reads back unchanged.
export type ConversationMetadata = GeneratedConversationMetadata;
export type MessagePage = ConversationPage;
export type P2PMessage = ConversationMessage;

/** Peer presence status derived from MessagingLayer presence variants */
export interface PeerPresence {
  status: MessagingLayerType.Online | MessagingLayerType.Offline | MessagingLayerType.Away | MessagingLayerType.CustomState;
  customText?: string;
  customColor?: string;
  lastUpdate: number;
}

export interface P2PConversation {
  peerCid: bigint;
  peerUsername?: string;  // Store the peer's username for display
  messages: P2PMessage[];
  lastMessageIndex: number;
  unreadCount: number;
  typing: boolean;
  lastTypingUpdate: number;
  /** Null until something says: absent is unknown, not offline. */
  presence: PeerPresence | null;
}

export interface MessageCache {
  conversations: Map<bigint, P2PConversation>;
  messageQueue: P2PMessage[];
  maxQueueSize: number;
  maxMessagesPerConversation: number;
}
