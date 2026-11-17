/**
 * Retrying a message that previously failed.
 *
 * Split from MessageSender, which was over its line budget and holds the
 * first-send path. Resending is a different job: the message already exists, in
 * memory or in storage, and the work is finding it, proving it is actually
 * retryable, and putting it back through the wire without creating a second one.
 */
import { createMessage , type MessagingLayer } from '@/types/messaging-layer';
import { createMessagingLayerCommand , type P2PAttachment } from '@/types/p2p-types';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { persistMessageStatus } from './message-status-persistence';
import { markSendFailed } from './mark-send-failed';
import { debugLog } from '@/lib/debug-config';
import type { MessageSenderConfig } from './message-sender-types';
import type { P2PConversation } from './p2p-types';
import type { P2PMessage } from '@/lib/p2p/p2p-types';
import type { P2PCommand } from '@/types/p2p-commands';

interface CommandSender {
  sendP2PCommand: (peerCid: bigint, command: ReturnType<typeof createMessagingLayerCommand>) => Promise<void>;
}

export async function resendMessage(
  sender: CommandSender,
  config: MessageSenderConfig,
  peerCid: bigint,
  messageId: string,
  conversation: P2PConversation,
): Promise<void> {
  // Memory first, then storage. `loadFromStorage` restores every conversation
  // with `messages: []`, and nothing rehydrates it — so after a reload the red
  // "retry" bubble was rendered from the page store while this lookup searched
  // an empty array and threw, every time, for ever.
  let message: P2PMessage | undefined = conversation.messages.find(m => m.id === messageId);
  if (!message) {
    message = (await config.findStoredMessage(peerCid, messageId)) ?? undefined;
    if (message) {
      // Put it back in the window so the status mutations below, and any later
      // ack, find it where the rest of the code expects.
      conversation.messages.push(message);
    }
  }
  if (!message) {
    throw new Error(`Message ${messageId} not found in conversation`);
  }

  if (message.status !== 'failed') {
    debugLog('MessageSender', `[P2P] Message ${messageId} is not in failed state (${message.status}), skipping resend`);
    return;
  }

  debugLog('MessageSender', `[P2P] Resending message ${messageId} to ${peerCid}`);

  message.status = 'pending';
  message.error = undefined;
  config.notifyMessageStatusListeners(messageId, 'pending');

  await p2pAutoConnectService.ensurePeerConnectedInBackground(peerCid);

  const peerReady: boolean = await config.tryEnsurePeerReady(peerCid);
  if (!peerReady) {
    debugLog('MessageSender', `[P2P] Resending to ${peerCid} without CheckState confirmation`);
  }

  const currentCid: bigint | null = await config.getCurrentCid();
  if (!currentCid) {
    const reason: Error = new Error('Not connected to server');
    markSendFailed(config, message, messageId, reason, 'Not connected to server');
    throw reason;
  }

  const layer: MessagingLayer = createMessage(message.content, message.timestamp);
  const command: P2PCommand = createMessagingLayerCommand(
    layer,
    currentCid,
    peerCid,
    message.index,
    {
      messageId: message.id,
      replyTo: message.replyTo,
      mentions: message.mentions,
      attachments: message.attachments as P2PAttachment[] | undefined,
      messageType: message.message_type,
      documentId: message.document_id,
      documentTitle: message.document_title,
    },
  );

  try {
    await sender.sendP2PCommand(peerCid, command);
    message.status = 'sent';
    config.notifyMessageStatusListeners(messageId, 'sent');
    debugLog('MessageSender', `[P2P] Successfully resent message ${messageId}`);
  } catch (error) {
    markSendFailed(config, message, messageId, error, 'Failed to send');
    await persistMessageStatus(config, peerCid, messageId, message);
    throw error;
  }

  await persistMessageStatus(config, peerCid, messageId, message);
}
