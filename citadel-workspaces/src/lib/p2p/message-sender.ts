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
import { isSelfConversation } from '../scratchpad/self-conversation';

export type { MessageSenderConfig, SendMessageOptions } from './message-sender-types';

export class MessageSender {
  private readonly config: MessageSenderConfig;

  constructor(config: MessageSenderConfig) {
    this.config = config;
  }

  public async sendMessage(
    recipient_cid: bigint,
    content: string,
    options?: SendMessageOptions
  ): Promise<P2PMessage> {
    debugLog('MessageSender', `[P2P] *** sendMessage ENTRY *** recipient_cid=${recipient_cid?.toString().slice(0, 8)}..., content="${content.slice(0, 20)}..."`);

    // No PeerRegister from here -- the connect banner owns that request. A note to yourself (the
    // scratchpad) has no peer to connect to, so it asks for no connection at all.
    const toSelf: boolean = isSelfConversation(await this.config.getCurrentCid(), recipient_cid);
    const isAlreadyConnected: boolean = !toSelf && (await p2pAutoConnectService.isPeerConnected(recipient_cid) || this.config.isConnected(recipient_cid));
    if (!toSelf && (p2pRegistrationService.isPeerRegistered(recipient_cid) || isAlreadyConnected)) {
      void p2pAutoConnectService.ensurePeerConnectedInBackground(recipient_cid);
      const peerReady: boolean = await this.config.tryEnsurePeerReady(recipient_cid);
      if (!peerReady) {
        debugLog('MessageSender', `[P2P] Sending to ${recipient_cid.toString()} without CheckState confirmation (transport handles delivery)`);
      }
    }

    // The agent stores and sends it, and announces it to every window.
    return sendThroughAgent(this.config.agent(), recipient_cid, content, options);
  }

  /** Retry a message that previously failed. */
  public async resendMessage(peerCid: bigint, messageId: string): Promise<void> {
    return resendThroughAgent(this.config.agent(), peerCid, messageId);
  }

  public async sendRawMessage(recipient_cid: bigint, layer: MessagingLayer): Promise<void> {
    return rawMessageOp(this.config, recipient_cid, layer);
  }

  public async sendMessageAck(
    messageId: string,
    ackType: 'delivered' | 'read' | 'failed',
    peerCid: bigint,
    sender_cid?: bigint
  ): Promise<void> {
    return messageAckOp(this.config, messageId, ackType, peerCid, sender_cid);
  }

  public async sendP2PCommand(peerCid: bigint, command: import('@/types/p2p-types').P2PCommand, sender_cid?: bigint): Promise<void> {
    return p2pCommandOp(this.config, peerCid, command, sender_cid);
  }

  public async sendRawBytes(peerCid: bigint, bytes: Uint8Array, compressionHint?: CompressionHint): Promise<void> {
    return rawBytesOp(this.config, peerCid, bytes, compressionHint);
  }
}
