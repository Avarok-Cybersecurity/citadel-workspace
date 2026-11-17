/**
 * Workspace Operations
 *
 * Handles workspace request operations via the internal service.
 * Extracted from websocket-service.ts to reduce file size.
 */

import { WorkspaceClient, type WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { debugLog } from '../debug-config';
import { instanceManager, instanceChannel, instanceInboundRouter } from '../multi-instance';
import type { AckResult } from '@/lib/multi-instance/outbound-queue-types';

export interface WorkspaceOpsConfig {
  init: () => Promise<void>;
  getClient: () => WorkspaceClient | null;
}

export class WorkspaceOperations {
  private readonly config: WorkspaceOpsConfig;

  constructor(config: WorkspaceOpsConfig) {
    this.config = config;
  }

  async sendWorkspaceRequest(cid: bigint, request: unknown): Promise<void> {
    await this.config.init();

    if (cid === undefined || cid === null) {
      throw new Error('CID is required to send workspace request');
    }

    if (instanceManager.isLeader) {
      const client: WorkspaceClient | null = this.config.getClient();
      if (!client) {
        throw new Error('WebSocket client not available (leader without client)');
      }
      debugLog('WorkspaceOperations', '[Leader] Sending workspace request directly');
      await client.sendWorkspaceRequest(cid, request as WorkspaceProtocolRequest);
    } else {
      debugLog('WorkspaceOperations', '[Follower] Proxying workspace request through leader');

      const proxyRequest: { __workspaceRequestProxy: boolean; cid: string; request: unknown; } = {
        __workspaceRequestProxy: true,
        cid: cid.toString(),
        request: request
      };

      const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
      instanceInboundRouter.registerPendingRequest(requestId, instanceManager.instanceId);

      const result: AckResult = await instanceChannel.sendToLeader(proxyRequest, requestId);

      if (result.status === 'error') {
        throw new Error(`Leader failed to send workspace request: ${result.error}`);
      }

      debugLog('WorkspaceOperations', '[Follower] Workspace request proxied successfully');
    }
  }
}
