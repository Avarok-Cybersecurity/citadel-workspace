/**
 * WebSocket Service - Request Sending
 *
 * Core request dispatch logic for leader/follower architecture.
 * Leader sends directly via WebSocket; follower proxies through leader.
 */

import type { InternalServiceRequest } from 'citadel-workspace-client-ts';
import { debugLog } from '../debug-config';
import { instanceManager, instanceChannel, instanceInboundRouter } from '../multi-instance';
import type { WebSocketServiceCore } from './core';
import type { AckResult } from '@/lib/multi-instance/outbound-queue-types';

/**
 * SINGLE-WEBSOCKET ARCHITECTURE: Send a request to the internal service.
 * - Leader: Sends directly via WebSocket
 * - Follower: Proxies through leader via BroadcastChannel
 */
/**
 * The `request_id` inside the request payload, if it has one.
 *
 * Requests are single-key objects — `{ GetSessions: { request_id, ... } }` — and
 * the internal service echoes that id on the response.
 */
function embeddedRequestId(request: Record<string, unknown>): string | undefined {
  const [payload] = Object.values(request);
  if (payload === null || typeof payload !== 'object') return undefined;
  const id: unknown = (payload as Record<string, unknown>).request_id;
  return typeof id === 'string' ? id : undefined;
}

export async function sendRequest(
  service: WebSocketServiceCore,
  request: Record<string, unknown>,
  requestId?: string
): Promise<void> {
  await service.init();

  const messageType: string = Object.keys(request)[0] || 'unknown';
  debugLog('WebSocketService', `_sendRequest: isLeader=${instanceManager.isLeader}, leaderId=${instanceManager.leaderId}, instanceId=${instanceManager.instanceId}, msgType=${messageType}`);

  if (instanceManager.isLeader) {
    if (!service.client) {
      debugLog('WebSocketService', `Leader without client, cannot send ${messageType}`);
      throw new Error('WebSocket client not available (leader without client)');
    }
    debugLog('WebSocketService', `[Leader] Sending ${messageType} directly`);
    // The answer comes back to THIS tab, whatever session it names. Untracked, it fell to
    // CID routing: a claim the leader made for a follower's session was answered to the
    // follower, and the leader timed out on a claim that had succeeded (seen live).
    const ownId: string | undefined = requestId ?? embeddedRequestId(request);
    if (ownId !== undefined) instanceInboundRouter.registerPendingRequest(ownId, instanceManager.instanceId);
    await service.client.sendDirectToInternalService(request as InternalServiceRequest);
  } else {
    debugLog('WebSocketService', `[Follower] Proxying ${messageType} through leader ${instanceManager.leaderId}`);
    // Key the leader's pending map on the id the RESPONSE will carry.
    //
    // A fresh UUID here is a DIFFERENT id from the `request_id` embedded in the
    // payload, and the internal service echoes the embedded one. So the leader's
    // routeByRequestId missed, routeByCid got null (GetSessions replies with
    // cid 0, which is falsy), and the response was processed locally on the
    // leader — a tab with no such pending request — while the follower waited
    // out its timeout.
    //
    // Connect and Register work from followers precisely because they pass
    // their embedded requestId through explicitly. Deriving it here fixes every
    // sendMessage()-based flow at once rather than one more call site.
    const id: string = requestId ?? embeddedRequestId(request) ?? crypto.randomUUID();

    instanceInboundRouter.registerPendingRequest(id, instanceManager.instanceId);

    const result: AckResult = await instanceChannel.sendToLeader(request, id);

    if (result.status === 'error') {
      debugLog('WebSocketService', `Follower proxy failed for ${messageType}: ${result.error}`);
      throw new Error(`Leader failed to send request: ${result.error}`);
    }

    debugLog('WebSocketService', `[Follower] Request ${messageType} proxied successfully`);
  }
}
