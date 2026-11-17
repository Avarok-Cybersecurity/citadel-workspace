/**
 * Leader Proxy Handlers
 *
 * Handles proxy requests from follower instances to the leader.
 * Each handler processes a specific proxy type (workspace request,
 * openMessenger, ensureMessenger, sendP2PMessage).
 */

import type { ProxyResponseData } from './outbound-queue-types';
import type { WorkspaceProtocolRequest, WorkspaceClient } from 'citadel-workspace-client-ts';
import { debugLog } from '@/lib/debug-config';
import { isCompressionHint } from '@/lib/p2p/compression-hints';
import type { ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';

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

export async function handleOpenMessengerProxy(
  request: ProxyRequest,
  sendAck: SendAckFn
): Promise<void> {
  debugLog('LeaderProxyHandlers', `Handling openMessenger proxy from ${request.senderInstanceId}`);

  const client: Awaited<ReturnType<typeof getWebSocketClient>> = await getWebSocketClient();
  if (!client) {
    debugLog('LeaderProxyHandlers', 'No WASM client available for openMessenger');
    sendAck(request.senderInstanceId, request.requestId, 'error', 'No WASM client');
    return;
  }

  await client.openMessengerFor(request.payload.cid as string);

  sendAck(request.senderInstanceId, request.requestId, 'processed');
  debugLog('LeaderProxyHandlers', `openMessenger proxy processed for ${request.requestId}`);
}

export async function handleEnsureMessengerProxy(
  request: ProxyRequest,
  sendAck: SendAckFn
): Promise<void> {
  debugLog('LeaderProxyHandlers', `Handling ensureMessenger proxy from ${request.senderInstanceId}`);

  const client: Awaited<ReturnType<typeof getWebSocketClient>> = await getWebSocketClient();
  if (!client) {
    debugLog('LeaderProxyHandlers', 'No WASM client available for ensureMessenger');
    sendAck(request.senderInstanceId, request.requestId, 'error', 'No WASM client');
    return;
  }

  const wasOpened: boolean = await client.ensureMessengerOpen(request.payload.cid as string);

  sendAck(request.senderInstanceId, request.requestId, 'processed', undefined, { wasOpened });
  debugLog('LeaderProxyHandlers', `ensureMessenger proxy processed for ${request.requestId}`);
}

export async function handleSendP2PMessageProxy(
  request: ProxyRequest,
  sendAck: SendAckFn
): Promise<void> {
  debugLog('LeaderProxyHandlers', `Handling sendP2PMessage proxy from ${request.senderInstanceId}`);

  const client: Awaited<ReturnType<typeof getWebSocketClient>> = await getWebSocketClient();
  if (!client) {
    debugLog('LeaderProxyHandlers', 'No WASM client available for sendP2PMessage');
    sendAck(request.senderInstanceId, request.requestId, 'error', 'No WASM client');
    return;
  }

  // The follower chose the hint where it built the payload; it crosses the tab
  // boundary as data, so it is checked here rather than trusted.
  const hint: unknown = request.payload.compressionHint;
  if (hint !== undefined && !isCompressionHint(hint)) {
    sendAck(request.senderInstanceId, request.requestId, 'error', `Unknown compression hint ${String(hint)}`);
    return;
  }

  const messageBytes: Uint8Array<ArrayBuffer> = new Uint8Array(request.payload.message as ArrayLike<number>);
  await client.sendP2PMessageReliable(
    request.payload.localCid as string,
    request.payload.peerCid as string,
    messageBytes,
    request.payload.securityLevel as ChatSecurityLevel | undefined,
    hint
  );

  sendAck(request.senderInstanceId, request.requestId, 'processed');
  debugLog('LeaderProxyHandlers', `sendP2PMessage proxy processed for ${request.requestId}`);
}

/** What this leader's socket was told by the agent: a follower has no socket to ask. */
export async function handleAgentCapabilitiesProxy(
  request: ProxyRequest,
  sendAck: SendAckFn
): Promise<void> {
  const { agentCapabilities, noticesHeard } = await import('../agent-conversations/capabilities');
  sendAck(request.senderInstanceId, request.requestId, 'processed', undefined, { ...(await agentCapabilities()), noticesHeard: noticesHeard.get() });
}
