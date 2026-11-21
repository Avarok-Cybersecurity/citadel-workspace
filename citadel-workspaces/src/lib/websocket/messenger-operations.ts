/**
 * Messenger Operations
 *
 * A reliable P2P send. The agent hosts the account's ILM, so every window --
 * leader or follower -- hands the message to it with `SendReliable`, and the
 * answer means "ILM has it": stored, numbered and retransmitted until the peer
 * acknowledges it.
 */

import type { CompressionHint } from 'citadel-workspace-client-ts';
import type { ChatSecurityLevel } from '../p2p/chat-advanced-settings';
import { debugLog } from '../debug-config';

const UNSET_LEVEL: ChatSecurityLevel = 'Standard';

export interface MessengerConfig {
  init: () => Promise<void>;
}

export class MessengerOperations {
  private readonly config: MessengerConfig;

  constructor(config: MessengerConfig) {
    this.config = config;
  }

  async sendP2PMessageReliable(
    localCid: bigint,
    peerCid: bigint,
    message: Uint8Array,
    securityLevel?: ChatSecurityLevel,
    compressionHint?: CompressionHint
  ): Promise<void> {
    await this.config.init();

    if (localCid === undefined || localCid === null) {
      throw new Error('Local CID is required to send reliable P2P message');
    }

    if (peerCid === undefined || peerCid === null) {
      throw new Error('Peer CID is required to send reliable P2P message');
    }

    debugLog('MessengerOperations', 'Sending reliable P2P message', {
      localCid: localCid.toString(),
      peerCid: peerCid.toString(),
      messageLength: message.length,
      securityLevel,
      compressionHint
    });

    // An unset level is Standard: SendReliable names it.
    const { agentConversations } = await import('../agent-conversations/requests');
    await agentConversations.sendReliable(localCid, peerCid, message, securityLevel ?? UNSET_LEVEL, compressionHint ?? null);
  }
}
