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
  recipientCid: bigint,
  layer: MessagingLayer
): Promise<void> {
  const currentCid: bigint | null = await config.getCurrentCid();
  if (!currentCid) {
    throw new Error('Not connected to server');
  }

  await p2pAutoConnectService.ensurePeerConnectedInBackground(recipientCid);

  const conversation: P2PConversation = config.getOrCreateConversation(recipientCid);
  const command: P2PCommand = createMessagingLayerCommand(
    layer,
    currentCid,
    recipientCid,
    conversation.lastMessageIndex
  );

  await sendP2PCommand(config, recipientCid, command);
  debugLog('MessageSendOperations', `[P2P] Sent raw message type=${layer.type} to ${recipientCid.toString().slice(0, 8)}...`);
}

/**
 * Send a message acknowledgment
 */
export async function sendMessageAck(
  config: MessageSenderConfig,
  messageId: string,
  ackType: 'delivered' | 'read' | 'failed',
  peerCid: bigint,
  senderCid?: bigint
): Promise<void> {
  debugLog('MessageSendOperations', '[P2P] sendMessageAck:', {
    ack_type: ackType,
    message_id: messageId.slice(0, 8),
    to_peer: peerCid.toString().slice(0, 10),
  });
  const command: P2PCommand = createMessageAckCommand(messageId, ackType);
  await sendP2PCommand(config, peerCid, command, senderCid);
}

/**
 * Send, and give a messenger that is still opening one chance to finish.
 *
 * `ensureMessengerOpen` returns `false` for two different states — "already
 * open" and "being opened by another task" — and its own doc says so. Only one
 * of them is ready, and the callers below awaited it, discarded the answer and
 * sent immediately. A send racing a concurrent open therefore went out against a
 * handle that did not exist yet and came back "No messaging handle found for
 * local CID", which `peer-failure-detail` then translates and shows the user.
 *
 * The ambiguity belongs to the WASM binding and cannot be fixed from here: the
 * artefact is tracked, CI does not rebuild it, so a source change there would not
 * run. What can be fixed here is the consequence — the open completes in
 * milliseconds, so one bounded retry turns a spurious failure into a slightly
 * slower success.
 *
 * Exactly one retry, and only for that error. A channel that is genuinely closed
 * pays 250ms before reporting what it was always going to report.
 */
const MESSENGER_STILL_OPENING: RegExp = /no messaging handle found/i;
const RETRY_AFTER_MS: number = 250;

export async function sendAllowingForAConcurrentOpen(
  currentCid: bigint,
  peerCid: bigint,
  bytes: Uint8Array,
  compressionHint?: CompressionHint
): Promise<void> {
  // The chat's level, on every send, rather than leaving it unset (which the
  // WASM binding reads as Standard). Dormant today: no control sets a level
  // above Standard, because the pinned SDK does not honour one -- see
  // ChatSettingsAdvanced.
  const level: ChatSecurityLevel = (await chatAdvancedSettings.get(currentCid, peerCid)).securityLevel;
  await websocketService.ensureMessengerOpen(currentCid);
  try {
    await websocketService.sendP2PMessageReliable(currentCid, peerCid, bytes, level, compressionHint);
  } catch (error: unknown) {
    if (!MESSENGER_STILL_OPENING.test(String(error))) throw error;
    debugLog('MessageSendOperations', '[P2P] messenger was still opening; retrying once');
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
    await websocketService.ensureMessengerOpen(currentCid);
    await websocketService.sendP2PMessageReliable(currentCid, peerCid, bytes, level, compressionHint);
  }
}

/**
 * Send a P2P command to a peer
 */
export async function sendP2PCommand(
  config: MessageSenderConfig,
  peerCid: bigint,
  command: P2PCommand,
  senderCid?: bigint
): Promise<void> {
  const currentCid: bigint | null = senderCid || await config.getCurrentCid();
  if (!currentCid) {
    throw new Error('Not connected to server');
  }

  const messageBytes: Uint8Array<ArrayBufferLike> = serializeP2PCommand(command);

  debugLog('MessageSendOperations', `[P2P] *** sendP2PCommand *** from ${currentCid.toString().slice(0, 8)}... to ${peerCid.toString().slice(0, 8)}... (${messageBytes.length} bytes)`);

  debugLog('MessageSendOperations', `[P2P] *** Calling websocketService.sendP2PMessageReliable(${currentCid.toString().slice(0, 8)}..., ${peerCid.toString().slice(0, 8)}..., ...)`);
  await sendAllowingForAConcurrentOpen(currentCid, peerCid, messageBytes, compressionHintFor(command));
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

  await sendAllowingForAConcurrentOpen(currentCid, peerCid, bytes, compressionHint);
}
