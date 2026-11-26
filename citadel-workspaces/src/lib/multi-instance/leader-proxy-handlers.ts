/**
 * Leader Proxy Handlers
 *
 * Handles proxy requests from follower instances to the leader.
 * Each handler processes a specific proxy type (a workspace request, or
 * what the leader's agent offers).
 */

import type { ProxyResponseData } from './outbound-queue-types';
import type { WorkspaceProtocolRequest, WorkspaceClient } from 'citadel-workspace-client-ts';
import { debugLog } from '@/lib/debug-config';

interface ProxyRequest {
  requestId: string;
  senderInstanceId: string;
  payload: Record<string, unknown>;
}

type SendAckFn = (
  targetInstanceId: string,
  requestId: string,
  status: 'processed' | 'error',
  error?: string,
  data?: ProxyResponseData
) => void;

async function getWebSocketClient(): Promise<WorkspaceClient | null> {
  const { websocketService } = await import('../websocket-service');
  return websocketService.getClient();
}

export async function handleWorkspaceRequestProxy(
  request: ProxyRequest,
  sendAck: SendAckFn
): Promise<void> {
  debugLog('LeaderProxyHandlers', `Handling workspace request proxy from ${request.senderInstanceId}`);

  const client: Awaited<ReturnType<typeof getWebSocketClient>> = await getWebSocketClient();
  if (!client) {
    debugLog('LeaderProxyHandlers', 'No WASM client available for workspace request');
    sendAck(request.senderInstanceId, request.requestId, 'error', 'No WASM client');
    return;
  }

  const cid: bigint = BigInt(request.payload.cid as string | number | bigint | boolean);
  await client.sendWorkspaceRequest(cid, request.payload.request as WorkspaceProtocolRequest);

  sendAck(request.senderInstanceId, request.requestId, 'processed');
  debugLog('LeaderProxyHandlers', `Workspace request proxy processed for ${request.requestId}`);
}

/** What this leader's socket was told by the agent: a follower has no socket to ask. */
export async function handleAgentCapabilitiesProxy(
  request: ProxyRequest,
  sendAck: SendAckFn
): Promise<void> {
  const { agentCapabilities, noticesHeard, appNotices } = await import('../agent-conversations/capabilities');
  sendAck(request.senderInstanceId, request.requestId, 'processed', undefined, { ...(await agentCapabilities()), noticesHeard: noticesHeard.get(), appNotices: appNotices.get() });
}
