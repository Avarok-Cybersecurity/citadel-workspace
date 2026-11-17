/**
 * Message Handler - Routing Logic
 *
 * Handles MessagingLayer command routing: incoming messages, typing,
 * presence, file transfers, and RevFS operations.
 */

import { notifyMessageArrived } from './message-arrival-notification';
import type { P2PMessagingLayerPayload } from '@/types/p2p-types';
import {
  MessagingLayerType,
  isMessage,
  isRevfsOperation,
  TYPING_DISPLAY_DURATION_MS,
} from '@/types/messaging-layer';
import { routeRevfsOperation } from './revfs-layer-routing';
import { applyScreenshotNotice } from './inbound-screenshot-notice';
import { getPrivacySettings } from '@/lib/privacy-settings';
import { peerDisplayName } from '@/lib/peer-display';
import { p2pRegistrationService } from '../p2p-registration-service';
import { eventEmitter } from '../event-emitter';
import { applyIncomingEdit, applyIncomingDelete } from './inbound-revision';
import { applyIncomingReaction } from './inbound-reaction';
import { p2pAutoConnectService } from '../p2p-auto-connect-service';
import { debugLog, debugEnabled } from '@/lib/debug-config';
import { deliverToConversation, shouldAck } from './inbound-message-delivery';
import type { P2PMessage, PeerPresence } from './p2p-types';
import type { MessageHandlerConfig } from './message-handler-types';
import type { FileTransferMessageHandler } from './file-transfer-message-handler';
import type { P2PConversation } from '@/lib/p2p/p2p-types';
import type {  } from '@/lib/p2p/message-revision';
import type { MessagingLayer } from '@/types/messaging-layer';
import type { DeliveryOutcome } from '@/lib/p2p/inbound-message-delivery';

/**
 * Handle a MessagingLayer command by dispatching to the appropriate handler.
 */
export async function handleMessagingLayerCommand(
  config: MessageHandlerConfig,
  fileTransferHandler: FileTransferMessageHandler,
  payload: P2PMessagingLayerPayload,
  peerCid: bigint,
  recipientCid?: bigint
): Promise<void> {
  const { layer } = payload;

  config.markPeerReady(peerCid);
  p2pAutoConnectService.markChannelReady(peerCid);

  switch (layer.type) {
    case MessagingLayerType.Message:
      await handleIncomingMessage(config, payload, peerCid, recipientCid);
      break;

    case MessagingLayerType.MessageEdit:
      await applyIncomingEdit(config, peerCid, layer.message_id, layer.contents, layer.edited_at);
      break;

    case MessagingLayerType.MessageDelete:
      await applyIncomingDelete(config, peerCid, layer.message_id);
      break;

    case MessagingLayerType.MessageReaction:
      await applyIncomingReaction(config, peerCid, layer);
      break;

    case MessagingLayerType.Typing:
      handleTypingIndicator(config, peerCid);
      break;

    case MessagingLayerType.Online:
    case MessagingLayerType.Offline:
    case MessagingLayerType.Away:
      handlePresenceUpdate(config, peerCid, {
        status: layer.type,
        lastUpdate: Date.now(),
      });
      break;

    case MessagingLayerType.CustomState:
      handlePresenceUpdate(config, peerCid, {
        status: MessagingLayerType.CustomState,
        customText: layer.text,
        customColor: layer.indicator_icon_color,
        lastUpdate: Date.now(),
      });
      break;

    case MessagingLayerType.ScreenshotNotice:
      await applyScreenshotNotice(config, payload, peerCid, {
        notify: getPrivacySettings().notifyOnScreenshot,
        peerName: peerDisplayName(p2pRegistrationService.getPeerInfo(peerCid) ?? { cid: peerCid }),
      });
      break;

    case MessagingLayerType.CheckState:
      await config.handleCheckState(peerCid);
      break;

    case MessagingLayerType.CheckStateResponse:
      config.handleCheckStateResponse(peerCid);
      break;

    case MessagingLayerType.RevfsOperation:
      if (isRevfsOperation(layer)) {
        const myCid: bigint | null = await config.getCurrentCid();
        if (myCid) {
          await routeRevfsOperation(peerCid, myCid, layer.operation);
        }
      }
      break;

    case MessagingLayerType.FileTransferRequest:
    case MessagingLayerType.FileTransferResponse:
    case MessagingLayerType.FileTransferProgress:
    case MessagingLayerType.FileTransferComplete:
    case MessagingLayerType.FileTransferCancel:
    case MessagingLayerType.FileTransferChunk: {
      debugLog('P2PMessageHandler', 'Received file transfer message:', layer.type, 'from:', peerCid?.toString().slice(0, 8));
      const effectiveRecipientCid: bigint | null = recipientCid || (await config.getCurrentCid());
      // Its only listener is FileTransferService, whose module the build puts in
      // a chunk the page components load; this router is in one index loads on
      // its own. Emitted before that chunk had run, an offer reached nobody: no
      // record and no "arriving" mark, so its bubble read "Offer expired" the
      // moment it appeared. Loading the module registers the listener.
      await import('../file-transfer/service');
      eventEmitter.emit('p2p:file-transfer-message', {
        layer,
        senderCid: peerCid.toString(),
        recipientCid: effectiveRecipientCid?.toString(),
      });
      await fileTransferHandler.handleFileTransferMessage(payload, peerCid);
      break;
    }
    default:
      // Unhandled types left the switch with no trace, reading identically to
      // "never arrived" - the blind spot that made the reconnect loss
      // unplaceable, since ILM proved delivery and the client proved nothing.
      debugLog('P2PMessageHandler', '[LOSS-DIAG] dropped: no handler for layer type',
        (layer as { type?: unknown }).type, 'message_id=', payload.message_id);
      break;
  }
}

/** Handle an incoming text message from a peer. */
async function handleIncomingMessage(
  config: MessageHandlerConfig,
  payload: P2PMessagingLayerPayload,
  peerCid: bigint,
  recipientCid?: bigint
): Promise<void> {
  const layer: MessagingLayer = payload.layer;
  if (!isMessage(layer)) {
    // Silent before this: a payload routed as a message but failing the shape
    // check vanished with no line anywhere - indistinguishable from one the
    // network never delivered, though ILM's logs prove delivery.
    debugLog('P2PMessageHandler', '[LOSS-DIAG] dropped: failed isMessage',
      'message_id=', payload.message_id, 'type=', (layer as { type?: unknown }).type);
    return;
  }

  const message: P2PMessage = {
    id: payload.message_id,
    content: layer.contents,
    // Transport peer: `sender_cid` is attacker-chosen, and the victim's own
    // CID would render a forged message as "You" in their own transcript.
    senderCid: peerCid,
    recipientCid: BigInt(payload.recipient_cid),
    timestamp: layer.timestamp,
    index: payload.index,
    status: 'delivered',
    replyTo: payload.reply_to,
    mentions: payload.mentions,
    attachments: payload.attachments,
    message_type: payload.message_type || 'text',
    document_id: payload.document_id,
    document_title: payload.document_title,
  };

  const outcome: DeliveryOutcome = await deliverToConversation(
    () => config.addMessageToConversation(peerCid, message),
    message.id
  );
  const wasAdded: boolean = outcome.present;

  // Logs the CONTENT, which the other lines do not, so a failing run says which
  // message was dropped and whether the store accepted it.
  if (debugEnabled) {
    debugLog(
      'P2PMessageHandler',
      `[LOSS-DIAG] id=${message.id} added=${wasAdded} index=${message.index} text=${JSON.stringify(
        String(message.content ?? '').slice(0, 60),
      )}`,
    );
  }

  if (wasAdded) {
    if (shouldAck(outcome)) {
      try {
        await config.sendMessageAck(message.id, 'delivered', peerCid, recipientCid);
      } catch (error) {
        debugLog('P2PMessageHandler', 'Delivery ACK send failed (non-blocking):', error);
      }
    }

    debugLog('P2PMessageHandler', 'Notifying listeners of new message:', message.id);
    config.notifyMessageListeners(message);

    eventEmitter.emit('p2p:message-received', {
      peerCid,
      messageId: message.id,
      text: message.content,
      timestamp: message.timestamp,
      message,
    });

    notifyMessageArrived(config, peerCid, message, recipientCid);
  } else {
    debugLog('P2PMessageHandler', 'Skipping duplicate message notification:', message.id);
  }
}

/** Handle a typing indicator from a peer. */
function handleTypingIndicator(config: MessageHandlerConfig, peerCid: bigint): void {
  const timestamp: number = Date.now();
  const conversation: P2PConversation = config.getOrCreateConversation(peerCid);
  conversation.typing = true;
  conversation.lastTypingUpdate = timestamp;

  config.notifyTypingListeners(peerCid, true);

  setTimeout(() => {
    const conv: P2PConversation | undefined = config.getConversations().get(peerCid);
    if (conv && conv.lastTypingUpdate === timestamp) {
      conv.typing = false;
      config.notifyTypingListeners(peerCid, false);
    }
  }, TYPING_DISPLAY_DURATION_MS);
}

/** Handle a presence update from a peer. */
function handlePresenceUpdate(config: MessageHandlerConfig, peerCid: bigint, presence: PeerPresence): void {
  const conversation: P2PConversation = config.getOrCreateConversation(peerCid);
  conversation.presence = presence;
  config.notifyPresenceListeners(peerCid, presence);
}
