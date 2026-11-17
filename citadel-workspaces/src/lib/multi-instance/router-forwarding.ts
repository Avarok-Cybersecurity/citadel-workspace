/**
 * Acknowledged cross-tab forwarding.
 *
 * A forward used to be a bare BroadcastChannel post: no ack, no retry, and
 * MessageNotification is not in LEADER_MUST_PROCESS_LOCALLY, so the leader kept
 * no copy. Three ways that lost a message — the target tab mid-reload (the
 * channel does not queue for absent listeners), a tab whose P2P handler had not
 * subscribed yet, and a "ghost" instance that died without announcing it.
 *
 * One mechanism covers all three: the leader retains every forward until the
 * target acks. Ack drops it; a cid re-registration replays it; a timeout falls
 * back to processing locally and unregisters the ghost. The receiving tab acks
 * only once its P2P handler is attached, so an ack always means the message
 * reached something that can act on it.
 *
 * Split from instance-inbound-router.ts to keep that file under the 250-line
 * cap, and because "how a forward is guaranteed" is a separate concern from
 * "which tab a message belongs to".
 */

import { eventEmitter } from '../event-emitter';
import { instanceChannel } from './instance-channel';
import { instanceManager } from './instance-manager';
import { getMessageType } from './routing-rules';
import { debugLog } from '@/lib/debug-config';
import { logEmit, mustHoldForP2PHandler } from './router-diagnostics';
import { isP2PMessageHandlerAttached } from '@/lib/p2p/p2p-handler-ready';

/**
 * The orphan buffer's fallback for an un-acked forward.
 *
 * Unregistering the target matters as much as the local fallback: without it
 * every subsequent message to that CID pays the full timeout again before
 * being delivered.
 */
export type ForwardFallback = (message: Record<string, unknown>, messageType: string, targetInstanceId?: string, fanOut?: string[]) => void;

export function makeForwardFallback(
  processLocally: (message: Record<string, unknown>) => void,
  reroute: (message: Record<string, unknown>, messageType: string) => boolean,
): ForwardFallback {
  return (message: Record<string, unknown>, messageType: string, targetInstanceId?: string, fanOut?: string[]): void => {
    if (targetInstanceId) {
      debugLog('InstanceInboundRouter',
        `[ILM-Router] forward to ${targetInstanceId} not acked (${messageType}); unregistering, re-routing`);
      instanceManager.unregisterInstance(targetInstanceId);
      instanceChannel.requestCidReport();
      // The same message went to other tabs holding the session too: while one
      // of them is still registered it has it, and re-routing would hand it to
      // each of them a second time. The last of them to time out re-routes.
      const stillHeld: Set<string> = new Set(instanceManager.getAllInstances().map((i) => i.instanceId));
      if ((fanOut ?? []).some((id: string) => id !== targetInstanceId && stillHeld.has(id))) return;
      // Another tab may hold the CID now (the session reopened elsewhere). Processing on
      // the leader would hand that tab's answer to the wrong session; re-routing finds
      // the live owner, or buffers it as unowned, whose own fallback is local processing.
      // Not delivered means no tab owns the CID yet: the re-route already processed it
      // here or buffered it as unowned, so this only records which path it took.
      if (!reroute(message, messageType)) {
        debugLog('InstanceInboundRouter', `[ILM-Router] re-routed ${messageType} has no owner; handled on the leader`);
      }
      return;
    }
    processLocally(message);
  };
}

/**
 * Wire the receiving side (process + ack) and the leader side (ack retires the
 * retained copy).
 */
export function attachForwardListeners(handlers: {
  processLocally: (message: unknown) => void;
  retireForward: (requestId: string) => void;
}): void {
  eventEmitter.on('channel:inbound-message',
    (data: { payload: unknown; senderInstanceId: string; requestId?: string }) => {
      const messageType: ReturnType<typeof getMessageType> = getMessageType(data.payload);
      debugLog('InstanceInboundRouter', `[ILM-Router] Received forwarded message: type=${messageType}`);

      if (data.requestId && !isP2PMessageHandlerAttached()) {
        // Neither process NOR ack. The leader still holds the authoritative
        // copy and will re-forward on cid re-registration or fall back on
        // timeout; processing without acking would split delivery across tabs.
        debugLog('InstanceInboundRouter',
          `[ILM-Router] Withholding ack for ${messageType}: P2P handler not attached`);
        return;
      }

      handlers.processLocally(data.payload);
      if (data.requestId) {
        instanceChannel.sendInboundAck(data.senderInstanceId, data.requestId);
      }
    });

  // Every tab sees this event but only the leader holds entries, so a miss on
  // a follower is normal and needs no leader guard.
  eventEmitter.on('channel:inbound-ack', (data: { requestId: string }) => {
    handlers.retireForward(data.requestId);
  });
}

/**
 * Prune request→instance entries that no response ever came back for.
 *
 * Without this the map grows for the life of the tab: every proxied request
 * that times out, errors, or whose instance disappears leaves an entry behind.
 */
export function startPendingRequestCleanup(
  pending: Map<string, { instanceId: string; timestamp: number }>,
  timeoutMs: number,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now: number = Date.now();
    for (const [requestId, entry] of pending) {
      if (now - entry.timestamp > timeoutMs) pending.delete(requestId);
    }
  }, intervalMs);
}

/**
 * Deliver a message to this tab's subscribers.
 *
 * Holds MessageNotification until the P2P handler has attached. Emitting
 * before then hands it to the services that subscribe at module load and to
 * nobody who can act on it — which is precisely how msg_id=10 was lost in CI
 * run 32912073077: emitted twice to eight listeners, with the P2P handler
 * still absent and attaching moments later.
 */
export function emitLocal(message: unknown): void {
  if (mustHoldForP2PHandler(message)) return;
  logEmit(eventEmitter.listenerCount('websocket-message'), message);
  eventEmitter.emit('websocket-message', message);
}
