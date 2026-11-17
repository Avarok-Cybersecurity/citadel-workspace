/**
 * Message Ack Handler
 *
 * Handles message acknowledgment processing (delivered, read, failed).
 */

import type { P2PMessageAckPayload } from '@/types/p2p-types';
import type { P2PMessage, P2PConversation } from './p2p-types';
import { debugLog } from '@/lib/debug-config';
import { statusAdvances } from './message-status';

export interface MessageAckHandlerConfig {
  /** Get conversations map */
  getConversations: () => Map<bigint, P2PConversation>;
  /** Update message status in pages */
  updateMessageInPages: (peerCid: bigint, messageId: string, updates: Partial<P2PMessage>) => Promise<boolean>;
  /** Notify message status listeners */
  notifyMessageStatusListeners: (messageId: string, status: P2PMessage['status']) => void;
}

export class MessageAckHandler {
  private readonly config: MessageAckHandlerConfig;

  constructor(config: MessageAckHandlerConfig) {
    this.config = config;
  }

  /**
   * Handle message acknowledgment
   */
  /**
   * @param peerCid The peer this ack arrived from. Required for the page-store
   *   fallback below; the in-memory scan alone cannot see a message that is
   *   outside the 100-message window or predates a reload.
   */
  public async handleMessageAck(payload: P2PMessageAckPayload, peerCid?: bigint): Promise<void> {
    debugLog('MessageAckHandler', '[P2P] handleMessageAck received:', {
      ack_type: payload.ack_type,
      message_id: payload.message_id.slice(0, 8),
    });

    let statusUpdated: boolean = false;
    let newStatus: P2PMessage['status'] = 'sent';
    const updatedMessages: Array<{ peerCid: bigint; messageId: string; status: P2PMessage['status']; error?: string }> = [];

    const conversations: Map<bigint, P2PConversation> = this.config.getConversations();

    conversations.forEach((conversation, peerCid) => {
      const message: P2PMessage | undefined = conversation.messages.find(m => m.id === payload.message_id);
      if (message) {
        debugLog('MessageAckHandler', '[P2P] handleMessageAck FOUND message, updating status:', message.status, '->', payload.ack_type);
        newStatus = payload.ack_type === 'failed' ? 'failed' : payload.ack_type;
        // The rule `propagateStatusToEarlierMessages` below has always applied,
        // and this assignment never did. Receipts arrive more than once — the
        // sender resends on a missed ACK and re-ACKing is deliberate — so a
        // `delivered` receipt routinely lands after the recipient has read the
        // message, and this turned the tick backwards.
        if (!statusAdvances(message.status, newStatus)) return;
        message.status = newStatus;
        if (payload.error) {
          message.error = payload.error;
        }
        statusUpdated = true;
        updatedMessages.push({ peerCid, messageId: message.id, status: newStatus, error: payload.error });

        // Mark earlier messages from same sender to same status
        if (newStatus === 'read' || newStatus === 'delivered') {
          this.propagateStatusToEarlierMessages(conversation, message, newStatus, peerCid, updatedMessages);
        }
      }
    });

    // Persist status updates
    await Promise.all(
      updatedMessages.map(({ peerCid, messageId, status, error }) =>
        this.config.updateMessageInPages(peerCid, messageId, { status, error })
      )
    );

    if (statusUpdated) {
      debugLog('MessageAckHandler', '[P2P] handleMessageAck notifying listeners for', updatedMessages.length, 'messages');
      updatedMessages.forEach(({ messageId }) => {
        this.config.notifyMessageStatusListeners(messageId, newStatus);
      });
    } else if (peerCid !== undefined) {
      // The in-memory window is capped at 100 and is EMPTY after a reload, so
      // this miss is the ordinary offline-peer flow, not an anomaly: send to an
      // offline peer, reload, the peer comes online hours later and acks. That
      // ack used to be dropped with a debug line, leaving the message on a
      // single check for ever even though it had been read.
      const status: P2PMessage['status'] =
        payload.ack_type === 'failed' ? 'failed' : payload.ack_type;
      const patched: boolean = await this.config.updateMessageInPages(peerCid, payload.message_id, {
        status,
        error: payload.error,
      });

      if (patched) {
        debugLog('MessageAckHandler', '[P2P] Ack applied to stored page for', payload.message_id.slice(0, 8));
        this.config.notifyMessageStatusListeners(payload.message_id, status);
      } else {
        debugLog('MessageAckHandler', 'handleMessageAck: message not in memory or in storage', payload.message_id.slice(0, 8));
      }
    } else {
      debugLog('MessageAckHandler', 'handleMessageAck: Message NOT FOUND and no peer to search', payload.message_id.slice(0, 8));
    }
  }

  /**
   * Propagate read/delivered status to earlier messages from the same sender
   */
  private propagateStatusToEarlierMessages(
    conversation: P2PConversation,
    ackedMessage: P2PMessage,
    newStatus: P2PMessage['status'],
    peerCid: bigint,
    updatedMessages: Array<{ peerCid: bigint; messageId: string; status: P2PMessage['status']; error?: string }>
  ): void {
    const ackedMessageTimestamp: number = ackedMessage.timestamp;
    const ackedMessageSender: bigint = ackedMessage.senderCid;

    conversation.messages.forEach(earlierMsg => {
      if (
        earlierMsg.senderCid === ackedMessageSender &&
        earlierMsg.timestamp < ackedMessageTimestamp &&
        earlierMsg.id !== ackedMessage.id &&
        (earlierMsg.status === 'sent' || earlierMsg.status === 'delivered')
      ) {
        // Only upgrade status (sent -> delivered -> read), never downgrade.
        // Same rule as the direct assignment above; see message-status.ts.
        if (statusAdvances(earlierMsg.status, newStatus)) {
          earlierMsg.status = newStatus;
          updatedMessages.push({ peerCid, messageId: earlierMsg.id, status: newStatus });
        }
      }
    });
  }
}
