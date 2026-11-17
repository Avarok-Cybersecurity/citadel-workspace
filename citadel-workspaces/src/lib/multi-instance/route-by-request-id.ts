/**
 * Routing a response back to the tab that ASKED for it.
 *
 * Split from the router when it outgrew its ceiling, and split along this seam
 * on purpose: the by-request-id path and the by-cid path answer different
 * questions — "who asked for this?" versus "who is this addressed to?" — and
 * confusing the two is exactly what `CID_ROUTED_NOTIFICATIONS` exists to
 * prevent. They read better apart than interleaved.
 */
import { instanceChannel } from './instance-channel';
import { instanceManager } from './instance-manager';
import { extractTargetCid } from './message-routing';
import { INTERIM_ANSWERS, LEADER_MUST_PROCESS_LOCALLY } from './routing-rules';
import { debugLog } from '@/lib/debug-config';

export interface PendingRequest {
  instanceId: string;
  timestamp: number;
}

export interface RequestRouteDeps {
  pendingRequestMap: Map<string, PendingRequest>;
  processLocalMessage: (message: unknown) => void;
}

/** Returns whether the message was claimed by a pending request. */
export function routeByRequestId(
  deps: RequestRouteDeps,
  message: Record<string, unknown>,
  messageType: string,
  requestId: string,
): boolean {
  const pending: PendingRequest | undefined = deps.pendingRequestMap.get(requestId);
  if (!pending) return false;

  debugLog('InstanceInboundRouter',
    `[ILM-Router] Routing ${messageType} by request_id ${requestId} -> ${pending.instanceId}`
  );
  // An interim answer leaves the route in place for the answer that ends the request.
  if (!INTERIM_ANSWERS.has(messageType)) deps.pendingRequestMap.delete(requestId);

  if (messageType === 'ConnectSuccess' || messageType === 'RegisterSuccess') {
    const cid: string | null = extractTargetCid(message);
    if (cid) {
      debugLog('InstanceInboundRouter', `[ILM-Router] Registering CID ${cid} for instance ${pending.instanceId}`);
      instanceManager.registerInstance(pending.instanceId, BigInt(cid));
    }
  }

  if (pending.instanceId === instanceManager.instanceId) {
    deps.processLocalMessage(message);
  } else {
    instanceChannel.forwardToInstance(pending.instanceId, message);
    if (LEADER_MUST_PROCESS_LOCALLY.has(messageType)) {
      debugLog('InstanceInboundRouter', `[ILM-Router] Also processing ${messageType} locally for central state (via request_id path)`);
      deps.processLocalMessage(message);
    }
  }
  return true;
}
