/**
 * Message Handler - Types & Type Guards
 *
 * Interfaces and type guards for InternalServiceResponse variants
 * used by the message handler.
 */

import { isResponseType , type InternalServiceResponse } from 'citadel-workspace-client-ts';
import type { P2PMessage, P2PConversation, PeerPresence } from './p2p-types';

// ============================================================================
// Response payload interfaces
// ============================================================================

export interface PeerMessagePayload {
  peer_cid: bigint | string | number;
  message: Uint8Array | number[];
}

export interface MessageNotificationPayload {
  cid: bigint | string | number;
  peer_cid: bigint | string | number;
  message: Uint8Array | number[];
}

// ============================================================================
// Type guards for InternalServiceResponse variants
// ============================================================================

export function isPeerMessage(
  response: InternalServiceResponse
): response is InternalServiceResponse & { PeerMessage: PeerMessagePayload } {
  // TYPE-GAP: 'PeerMessage' exists at runtime but not in generated ResponseType
  return 'PeerMessage' in response;
}

export function isMessageNotification(
  response: InternalServiceResponse
): response is InternalServiceResponse & { MessageNotification: MessageNotificationPayload } {
  return isResponseType(response, 'MessageNotification');
}

// ============================================================================
// MessageHandler configuration interface
// ============================================================================

export interface MessageHandlerConfig {
  getCurrentCid: () => Promise<bigint | null>;
  isConnected: (peerCid: bigint) => boolean;
  getOrCreateConversation: (peerCid: bigint) => P2PConversation;
  addMessageToConversation: (peerCid: bigint, message: P2PMessage) => Promise<boolean>;
  updateMessageInPages: (peerCid: bigint, messageId: string, updates: Partial<P2PMessage>) => Promise<boolean>;
  removeMessageFromPages: (peerCid: bigint, messageId: string) => Promise<boolean>;
  getConversations: () => Map<bigint, P2PConversation>;
  notifyMessageListeners: (message: P2PMessage) => void;
  notifyMessageStatusListeners: (messageId: string, status: P2PMessage['status']) => void;
  notifyTypingListeners: (peerCid: bigint, isTyping: boolean) => void;
  notifyPresenceListeners: (peerCid: bigint, presence: PeerPresence) => void;
  sendMessageAck: (messageId: string, ackType: 'delivered' | 'read' | 'failed', peerCid: bigint, recipientCid?: bigint) => Promise<void>;
  handleCheckState: (peerCid: bigint) => Promise<void>;
  handleCheckStateResponse: (peerCid: bigint) => void;
  markPeerReady: (peerCid: bigint) => void;
  shouldShowNotification: (peerCid: bigint) => boolean;
  addNotification: (
    title: string,
    body: string,
    senderId: string,
    messageId: string,
    recipientCid: string | undefined,
    options: { peerCid: string; onCardClick: () => void }
  ) => void;
}
