/**
 * Message Sender
 *
 * Sends P2P messages and commands to peers. A chat message is the agent's to
 * store and send (agent-conversations/agent-actions.ts); commands go through
 * message-send-operations.
 */

import type { MessagingLayer } from '@/types/messaging-layer';
import { p2pRegistrationService } from '../p2p-registration-service';
import { p2pAutoConnectService } from '../p2p-auto-connect-service';
import type { P2PMessage } from './p2p-types';
import type { MessageSenderConfig, SendMessageOptions } from './message-sender-types';
import {
  sendRawMessage as rawMessageOp,
  sendMessageAck as messageAckOp,
  sendP2PCommand as p2pCommandOp,
  sendRawBytes as rawBytesOp,
} from './message-send-operations';
import { debugLog } from '@/lib/debug-config';
import type { CompressionHint } from 'citadel-workspace-client-ts';
import { sendThroughAgent, resendThroughAgent } from '../agent-conversations/agent-actions';

export type { MessageSenderConfig, SendMessageOptions } from './message-sender-types';

export class MessageSender {
  private readonly config: MessageSenderConfig;

  constructor(config: MessageSenderConfig) {
    this.config = config;
  }

  public async sendMessage(
    recipientCid: bigint,
    content: string,
    options?: SendMessageOptions
  ): Promise<P2PMessage> {
    debugLog('MessageSender', `[P2P] *** sendMessage ENTRY *** recipientCid=${recipientCid?.toString().slice(0, 8)}..., content="${content.slice(0, 20)}..."`);

    // No PeerRegister from here -- the connect banner owns that request.
    const isAlreadyConnected: boolean = await p2pAutoConnectService.isPeerConnected(recipientCid) || this.config.isConnected(recipientCid);
    if (p2pRegistrationService.isPeerRegistered(recipientCid) || isAlreadyConnected) {
      void p2pAutoConnectService.ensurePeerConnectedInBackground(recipientCid);
      const peerReady: boolean = await this.config.tryEnsurePeerReady(recipientCid);
      if (!peerReady) {
        debugLog('MessageSender', `[P2P] Sending to ${recipientCid.toString()} without CheckState confirmation (transport handles delivery)`);
      }
    }

    // The agent stores and sends it, and announces it to every window.
    return sendThroughAgent(this.config.agent(), recipientCid, content, options);
  }

  /** Retry a message that previously failed. */
  public async resendMessage(peerCid: bigint, messageId: string): Promise<void> {
    return resendThroughAgent(this.config.agent(), peerCid, messageId);
  }

  public async sendRawMessage(recipientCid: bigint, layer: MessagingLayer): Promise<void> {
    return rawMessageOp(this.config, recipientCid, layer);
  }

  public async sendMessageAck(
    messageId: string,
    ackType: 'delivered' | 'read' | 'failed',
    peerCid: bigint,
    senderCid?: bigint
  ): Promise<void> {
    return messageAckOp(this.config, messageId, ackType, peerCid, senderCid);
  }

  public async sendP2PCommand(peerCid: bigint, command: import('@/types/p2p-types').P2PCommand, senderCid?: bigint): Promise<void> {
    return p2pCommandOp(this.config, peerCid, command, senderCid);
  }

  public async sendRawBytes(peerCid: bigint, bytes: Uint8Array, compressionHint?: CompressionHint): Promise<void> {
    return rawBytesOp(this.config, peerCid, bytes, compressionHint);
  }
}
