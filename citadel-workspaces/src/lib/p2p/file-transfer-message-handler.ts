/**
 * File Transfer Message Handler
 *
 * Handles incoming file transfer messages and creates P2P message entries.
 */

import type { P2PMessagingLayerPayload } from '@/types/p2p-types';
import { isFileTransferRequest , type MessagingLayer } from '@/types/messaging-layer';
import { eventEmitter } from '../event-emitter';
import type { P2PMessage, P2PConversation } from './p2p-types';
import { debugLog } from '@/lib/debug-config';
import { deliverToConversation, shouldAck, type DeliveryOutcome } from './inbound-message-delivery';
import { fileTransferMessage } from './file-transfer-message';

export interface FileTransferMessageHandlerConfig {
  /** Get or create conversation */
  getOrCreateConversation: (peerCid: bigint) => P2PConversation;
  /** Notify message listeners */
  notifyMessageListeners: (message: P2PMessage) => void;
  /** Send message ack */
  sendMessageAck: (messageId: string, ackType: 'delivered' | 'read' | 'failed', peerCid: bigint) => Promise<void>;
  /**
   * The same store every other inbound message goes through.
   *
   * It dedupes by id, persists the page, and increments the unread badge. This
   * handler used to push straight onto `conversation.messages` and skip all
   * three: a redelivered offer appeared twice in the thread with two Accept
   * buttons, and every received offer vanished on reload while the sender's
   * bubble still read "delivered".
   */
  addMessageToConversation: (peerCid: bigint, message: P2PMessage) => Promise<boolean>;
}

export class FileTransferMessageHandler {
  private readonly config: FileTransferMessageHandlerConfig;

  constructor(config: FileTransferMessageHandlerConfig) {
    this.config = config;
  }

  /**
   * Handle file transfer message
   */
  public async handleFileTransferMessage(payload: P2PMessagingLayerPayload, peerCid: bigint): Promise<void> {
    const layer: MessagingLayer = payload.layer;

    if (!isFileTransferRequest(layer)) {
      return;
    }

    // Transport peer as the sender, not `payload.sender_cid` — the same fix as
    // message-handler-routing, which was never carried to this sibling. Both
    // handle the same wire envelope from the same dispatcher; this one kept
    // trusting the field the sender chooses, so any registered peer could
    // attribute a file-transfer message to a third party in the victim's
    // conversation. `peerCid` is already a parameter here.
    const message: P2PMessage = fileTransferMessage(payload, layer, peerCid, 'delivered', 'pending');

    // Through the shared delivery path, not around it. `deliverToConversation`
    // separates "arrived" from "stored" so a LocalDB failure still shows the
    // offer, and `shouldAck` withholds the delivery ACK in that case -- a
    // message we could not store is gone on the next reload, so claiming
    // delivery would be a lie that outlives it. This handler acked
    // unconditionally, having never attempted a store at all.
    const outcome: DeliveryOutcome = await deliverToConversation(
      () => this.config.addMessageToConversation(peerCid, message),
      message.id,
    );

    if (!outcome.present) {
      debugLog('FileTransferMessageHandler', `[P2P] Duplicate file transfer offer ${message.id}, not re-announced`);
      return;
    }

    debugLog('FileTransferMessageHandler', `[P2P] Stored file transfer message in conversation with ${peerCid.toString().slice(0, 8)}...`);

    this.config.notifyMessageListeners(message);

    eventEmitter.emit('p2p:message-received', {
      peerCid,  // Keep as bigint for consistent typing (useP2PMessages hook expects bigint)
      messageId: message.id,
      text: message.content,
      timestamp: message.timestamp,
      message,
    });

    if (shouldAck(outcome)) {
      await this.config.sendMessageAck(message.id, 'delivered', peerCid);
    }
  }
}
