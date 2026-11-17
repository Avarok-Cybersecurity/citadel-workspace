/**
 * Messenger Operations
 *
 * Handles ISM (InterSession Messaging) messenger operations for reliable P2P messaging.
 * Extracted from websocket-service.ts to reduce file size.
 */

import { WorkspaceClient, type CompressionHint } from 'citadel-workspace-client-ts';
import type { ChatSecurityLevel } from '../p2p/chat-advanced-settings';
import { debugLog } from '../debug-config';
import { instanceManager, instanceChannel, instanceInboundRouter } from '../multi-instance';
import { isEnsureMessengerOpenResponse } from '../multi-instance/outbound-queue';
import type { AckResult } from '@/lib/multi-instance/outbound-queue-types';
import { agentHostsConversations } from '../agent-conversations/capabilities';

const UNSET_LEVEL: ChatSecurityLevel = 'Standard';

export interface MessengerConfig {
  init: () => Promise<void>;
  getClient: () => WorkspaceClient | null;
}

export class MessengerOperations {
  private readonly config: MessengerConfig;

  constructor(config: MessengerConfig) {
    this.config = config;
  }

  /**
   * Open a messenger handle for the given CID.
   * Creates an ISM (InterSession Messaging) channel for reliable-ordered messaging.
   *
   * SINGLE-WEBSOCKET ARCHITECTURE:
   * - Leader: Calls WASM method directly
   * - Follower: Proxies through leader via BroadcastChannel
   *
   * When the agent hosts the account's ILM there is nothing to open: a browser
   * ILM beside the agent's would split the per-source frontier.
   */
  async openMessengerFor(cid: bigint): Promise<void> {
    await this.config.init();

    if (cid === undefined || cid === null) {
      throw new Error('CID is required to open messenger');
    }
    if (await agentHostsConversations()) return;

    debugLog('MessengerOperations', 'Opening messenger handle for CID', { cid: cid.toString() });

    if (instanceManager.isLeader) {
      const client: WorkspaceClient | null = this.config.getClient();
      if (!client) {
        throw new Error('WebSocket client not available (leader without client)');
      }
      await client.openMessengerFor(cid.toString());
    } else {
      debugLog('MessengerOperations', '[Follower] Proxying openMessengerFor through leader');

      const proxyRequest: { __openMessengerProxy: boolean; cid: string; } = {
        __openMessengerProxy: true,
        cid: cid.toString()
      };

      const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
      instanceInboundRouter.registerPendingRequest(requestId, instanceManager.instanceId);

      const result: AckResult = await instanceChannel.sendToLeader(proxyRequest, requestId);
      if (result.status === 'error') {
        throw new Error(`Leader failed to open messenger: ${result.error}`);
      }
    }
  }

  /**
   * Ensures a messenger handle is open for the given CID.
   * Returns true if the messenger was just opened, false if already open.
   *
   * SINGLE-WEBSOCKET ARCHITECTURE:
   * - Leader: Calls WASM method directly
   * - Follower: Proxies through leader via BroadcastChannel
   */
  async ensureMessengerOpen(cid: bigint): Promise<boolean> {
    await this.config.init();

    if (cid === undefined || cid === null) {
      throw new Error('CID is required');
    }
    if (await agentHostsConversations()) return false;

    if (instanceManager.isLeader) {
      const client: WorkspaceClient | null = this.config.getClient();
      if (!client) {
        throw new Error('WebSocket client not available (leader without client)');
      }
      return await client.ensureMessengerOpen(cid.toString());
    } else {
      debugLog('MessengerOperations', '[Follower] Proxying ensureMessengerOpen through leader');

      const proxyRequest: { __ensureMessengerProxy: boolean; cid: string; } = {
        __ensureMessengerProxy: true,
        cid: cid.toString()
      };

      const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
      instanceInboundRouter.registerPendingRequest(requestId, instanceManager.instanceId);

      const result: AckResult = await instanceChannel.sendToLeader(proxyRequest, requestId);
      if (result.status === 'error') {
        throw new Error(`Leader failed to ensure messenger: ${result.error}`);
      }
      return isEnsureMessengerOpenResponse(result.data) ? result.data.wasOpened : false;
    }
  }

  /**
   * Send a reliable P2P message using the ISM (InterSession Messaging) layer.
   * This provides guaranteed delivery with retries and ordering.
   *
   * SINGLE-WEBSOCKET ARCHITECTURE:
   * - Leader: Calls WASM method directly
   * - Follower: Proxies through leader via BroadcastChannel
   */
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

    if (await agentHostsConversations()) {
      // An unset level is Standard on both routes: the WASM binding reads an
      // absent level as Standard, and SendReliable names it.
      const { agentConversations } = await import('../agent-conversations/requests');
      await agentConversations.sendReliable(localCid, peerCid, message, securityLevel ?? UNSET_LEVEL, compressionHint ?? null);
      return;
    }

    if (instanceManager.isLeader) {
      const client: WorkspaceClient | null = this.config.getClient();
      if (!client) {
        throw new Error('WebSocket client not available (leader without client)');
      }
      await client.sendP2PMessageReliable(localCid.toString(), peerCid.toString(), message, securityLevel, compressionHint);
    } else {
      debugLog('MessengerOperations', '[Follower] Proxying sendP2PMessageReliable through leader');

      // Convert Uint8Array to Array for serialization over BroadcastChannel
      const proxyRequest: { __sendP2PMessageProxy: boolean; localCid: string; peerCid: string; message: number[]; securityLevel: ChatSecurityLevel | undefined; compressionHint: CompressionHint | undefined; } = {
        __sendP2PMessageProxy: true,
        localCid: localCid.toString(),
        peerCid: peerCid.toString(),
        message: Array.from(message),
        securityLevel: securityLevel,
        compressionHint: compressionHint
      };

      const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
      instanceInboundRouter.registerPendingRequest(requestId, instanceManager.instanceId);

      const result: AckResult = await instanceChannel.sendToLeader(proxyRequest, requestId);
      if (result.status === 'error') {
        throw new Error(`Leader failed to send P2P message: ${result.error}`);
      }
    }
  }
}
