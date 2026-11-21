/**
 * Message Send Operations
 *
 * Low-level P2P command sending and raw message operations.
 */

import type { P2PCommand } from '@/types/p2p-types';
import {
  createMessagingLayerCommand,
  createMessageAckCommand,
  serializeP2PCommand,
} from '@/types/p2p-types';
import type { MessagingLayer } from '@/types/messaging-layer';
import { websocketService } from '../websocket-service';
import { p2pAutoConnectService } from '../p2p-auto-connect-service';
import type { MessageSenderConfig } from './message-sender-types';
import { debugLog } from '@/lib/debug-config';
import type { P2PConversation } from '@/lib/p2p/p2p-types';
import { chatAdvancedSettings, type ChatSecurityLevel } from './chat-advanced-settings';
import { compressionHintFor } from './compression-hints';
import type { CompressionHint } from 'citadel-workspace-client-ts';

/**
 * Send a raw MessagingLayer message to a peer (used by FileTransferService)
 */
export async function sendRawMessage(
  config: MessageSenderConfig,
  recipient_cid: bigint,
  layer: MessagingLayer
): Promise<void> {
  const currentCid: bigint | null = await config.getCurrentCid();
  if (!currentCid) {
    throw new Error('Not connected to server');
  }

  await p2pAutoConnectService.ensurePeerConnectedInBackground(recipient_cid);

  const conversation: P2PConversation = config.getOrCreateConversation(recipient_cid);
  const command: P2PCommand = createMessagingLayerCommand(
    layer,
    currentCid,
    recipient_cid,
    conversation.lastMessageIndex
  );

  await sendP2PCommand(config, recipient_cid, command);
  debugLog('MessageSendOperations', `[P2P] Sent raw message type=${layer.type} to ${recipient_cid.toString().slice(0, 8)}...`);
}

/**
 * Send a message acknowledgment
 */
export async function sendMessageAck(
  config: MessageSenderConfig,
  messageId: string,
  ackType: 'delivered' | 'read' | 'failed',
  peerCid: bigint,
  sender_cid?: bigint
): Promise<void> {
  debugLog('MessageSendOperations', '[P2P] sendMessageAck:', {
    ack_type: ackType,
    message_id: messageId.slice(0, 8),
    to_peer: peerCid.toString().slice(0, 10),
  });
  const command: P2PCommand = createMessageAckCommand(messageId, ackType);
  await sendP2PCommand(config, peerCid, command, sender_cid);
}

/** Send at the chat's level, on every send, rather than leaving it unset. */
export async function sendAtChatLevel(
  currentCid: bigint,
  peerCid: bigint,
  bytes: Uint8Array,
  compressionHint?: CompressionHint
): Promise<void> {
  // Dormant today: no control sets a level above Standard, because the pinned
  // SDK does not honour one -- see ChatSettingsAdvanced.
  const level: ChatSecurityLevel = (await chatAdvancedSettings.get(currentCid, peerCid)).securityLevel;
  await websocketService.sendP2PMessageReliable(currentCid, peerCid, bytes, level, compressionHint);
}

/**
 * Send a P2P command to a peer
 */
export async function sendP2PCommand(
  config: MessageSenderConfig,
  peerCid: bigint,
  command: P2PCommand,
  sender_cid?: bigint
): Promise<void> {
  const currentCid: bigint | null = sender_cid || await config.getCurrentCid();
  if (!currentCid) {
    throw new Error('Not connected to server');
  }

  const messageBytes: Uint8Array<ArrayBufferLike> = serializeP2PCommand(command);

  debugLog('MessageSendOperations', `[P2P] *** sendP2PCommand *** from ${currentCid.toString().slice(0, 8)}... to ${peerCid.toString().slice(0, 8)}... (${messageBytes.length} bytes)`);

  debugLog('MessageSendOperations', `[P2P] *** Calling websocketService.sendP2PMessageReliable(${currentCid.toString().slice(0, 8)}..., ${peerCid.toString().slice(0, 8)}..., ...)`);
  await sendAtChatLevel(currentCid, peerCid, messageBytes, compressionHintFor(command));
  debugLog('MessageSendOperations', `[P2P] *** websocketService.sendP2PMessageReliable completed successfully ***`);
}

/**
 * Send raw bytes to a peer (bypassing command serialization). The caller that
 * serialized them knows what they are, so it passes the hint.
 */
export async function sendRawBytes(
  config: MessageSenderConfig,
  peerCid: bigint,
  bytes: Uint8Array,
  compressionHint?: CompressionHint
): Promise<void> {
  const currentCid: bigint | null = await config.getCurrentCid();
  if (!currentCid) {
    throw new Error('Not connected to server');
  }

  await sendAtChatLevel(currentCid, peerCid, bytes, compressionHint);
}
