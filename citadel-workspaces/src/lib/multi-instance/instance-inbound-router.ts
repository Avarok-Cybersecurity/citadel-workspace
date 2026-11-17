/**
 * Instance Inbound Router (Singleton)
 *
 * Thin router class that delegates extraction to message-routing
 * and uses routing configuration from routing-rules.
 *
 * Routes incoming WebSocket messages to the correct instance.
 * Only runs on the leader instance (the one managing the WebSocket).
 */

import { eventEmitter } from '../event-emitter';
import { instanceManager } from './instance-manager';
import { makeForwardFallback, attachForwardListeners, startPendingRequestCleanup, emitLocal } from './router-forwarding';
import { setP2PReplay } from '@/lib/p2p/p2p-handler-ready';
import { instanceChannel } from './instance-channel';
import { debugLog } from '@/lib/debug-config';
import { routeByRequestId, type PendingRequest } from './route-by-request-id';
import { routeByCid, type CidRouteDeps } from './route-by-cid';
import { INTERVAL } from '../timeout-constants';
import {
  REQUEST_TRACKING_TIMEOUT_MS,
  getMessageType,
  shouldBroadcast,
  arrivesAtFrameRate,
} from './routing-rules';
import { extractRequestId } from './message-routing';
import { OrphanBuffer } from './orphan-buffer';

debugLog('InstanceInboundRouter', '[ILM-Router] Module loading...');

class InstanceInboundRouter {
  private static instance: InstanceInboundRouter;

  private pendingRequestMap: Map<string, PendingRequest> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  /**
   * Holds messages with no known owner AND forwards awaiting an ack. See
   * `orphan-buffer.ts` for the timer/replay lifecycle and
   * `router-forwarding.ts` for what a timeout does.
   */
  private readonly orphanBuffer: OrphanBuffer = new OrphanBuffer(
    makeForwardFallback(
      (message) => this.processLocalMessage(message),
      (message, messageType): boolean => routeByCid(this.cidRouteDeps(), message, messageType),
    ),
  );

  private constructor() {
    // Replays re-enter the same path, so a held message is delivered exactly
    // as a fresh one would be.
    setP2PReplay((message) => this.processLocalMessage(message));
    debugLog('InstanceInboundRouter', '[ILM-Router] Constructor called, setting up event listeners...');
    this.setupEventListeners();
    this.startCleanupInterval();
    debugLog('InstanceInboundRouter', '[ILM-Router] Constructor complete');
  }

  public static getInstance(): InstanceInboundRouter {
    if (!InstanceInboundRouter.instance) {
      InstanceInboundRouter.instance = new InstanceInboundRouter();
    }
    return InstanceInboundRouter.instance;
  }

  // ── Event Listeners ──────────────────────────────────────────────────

  private setupEventListeners(): void {
    // Leadership is read from instanceManager when asked, never copied here: the election flips
    // the manager before emitting, and a listener running ahead of this one saw the copy stale.
    eventEmitter.on('instance:leader-changed', (data: { isLeader: boolean; leaderId: string }) => {
      if (data.isLeader) {
        debugLog('InstanceInboundRouter', '[ILM-Router] Activated as leader');
      } else {
        debugLog('InstanceInboundRouter', '[ILM-Router] Deactivated (no longer leader)');
      }
    });

    attachForwardListeners({
      processLocally: (message) => this.processLocalMessage(message),
      retireForward: (requestId) => this.orphanBuffer.ack(requestId),
    });

    eventEmitter.on('channel:outbound-request', (data: { requestId?: string; senderInstanceId: string; payload?: unknown }) => {
      debugLog('InstanceInboundRouter', `[ILM-Router] channel:outbound-request requestId=${data.requestId}, sender=${data.senderInstanceId}, active=${instanceManager.isLeader}`);
      if (instanceManager.isLeader && data.requestId) {
        this.registerPendingRequest(data.requestId, data.senderInstanceId);
      }
    });

    // Drain the orphan buffer when a follower's cid-report arrives.
    // `instance:registered` fires for every cid-update; the buffer
    // is keyed by CID, so non-matching events are a cheap no-op.
    eventEmitter.on('instance:registered', (data: { instanceId: string; cid: bigint | null }) => {
      if (data.cid === null) return;
      this.orphanBuffer.drainForCid(data.cid.toString(), (entry) => {
        // Re-route via routeByCid so the just-registered owner is
        // picked up (instance map now has the entry). The recursion
        // is safe: the cid is now known, so we won't re-enter the
        // orphan branch.
        //
        // Its boolean IS that claim, tested. `false` means no instance owned
        // the cid after all -- the message is not lost (routeByCid hands it to
        // the leader), but a CID-routed notification processed by the leader
        // instead of the session it names is the wrong session, which is the
        // failure CID_ROUTED_NOTIFICATIONS exists to prevent. This drain is the
        // message's last chance to reach its owner: the fallback timer has
        // already been cleared and the entry is out of the buffer, so if
        // nothing says so here, nothing ever does.
        if (!routeByCid(this.cidRouteDeps(), entry.message, entry.messageType)) {
          console.warn(
            `[ILM-Router] Drained ${entry.messageType} for CID ${data.cid?.toString() ?? 'unknown'} ` +
              'after its owner registered, but no instance claimed it; the leader processed it ' +
              'instead of the addressed session.',
          );
        }
      });
    });
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  private startCleanupInterval(): void {
    this.cleanupInterval = startPendingRequestCleanup(
      this.pendingRequestMap, REQUEST_TRACKING_TIMEOUT_MS, INTERVAL.CLEANUP_MS);
  }

  registerPendingRequest(requestId: string, instanceId: string): void {
    this.pendingRequestMap.set(requestId, { instanceId, timestamp: Date.now() });
    debugLog('InstanceInboundRouter', `[ILM-Router] Registered pending request ${requestId} -> ${instanceId}`);
  }

  // ── Routing ──────────────────────────────────────────────────────────

  /**
   * Route one inbound message, and report whether it was DELIVERED — that is,
   * whether every tab entitled to this message has now been handed it.
   *
   * The caller needs that answer because there is a second delivery path
   * (`broadcastChannelService.broadcastWorkspaceResponse`) that used to run
   * alongside this one, suppressed only for the types listed in
   * `CID_ROUTED_NOTIFICATIONS`. That list was written for a different purpose —
   * stopping request_id routing — and every message that routes by CID without
   * being on it therefore reached the owning tab TWICE: once forwarded here,
   * once broadcast. All seven group notifications are built with
   * `request_id: None` and a recipient `cid`, so every group invite, join
   * request, member-state change, leave, end and disconnect was delivered
   * twice, and so was `DisconnectNotification` (broadcast here, then broadcast
   * again). A duplicated invite is a duplicated auto-accept.
   *
   * Answering from what actually happened, rather than from a hand-kept list of
   * types someone remembered to add, is what stops that list drifting again.
   */
  routeMessage(message: Record<string, unknown>): boolean {
    if (!instanceManager.isLeader) {
      debugLog('InstanceInboundRouter', '[ILM-Router] routeMessage called but not leader');
      return false;
    }

    const messageType: ReturnType<typeof getMessageType> = getMessageType(message);
    const requestId: string | null = extractRequestId(message);
    if (!arrivesAtFrameRate(messageType)) debugLog('InstanceInboundRouter',
      `[ILM-Router] routeMessage: type=${messageType}, requestId=${requestId}, pendingMapSize=${this.pendingRequestMap.size}`
    );

    if (shouldBroadcast(messageType)) {
      debugLog('InstanceInboundRouter', `[ILM-Router] Broadcasting ${messageType}`);
      this.broadcastToAll(message);
      return true; // Every tab already has it.
    }

    if (requestId) {
      const routed: boolean = routeByRequestId({ pendingRequestMap: this.pendingRequestMap, processLocalMessage: (m) => this.processLocalMessage(m) }, message, messageType, requestId);
      if (routed) return true;
    }

    return routeByCid(this.cidRouteDeps(), message, messageType);
  }

  /** The two things route-by-cid needs from this router. */
  private cidRouteDeps(): CidRouteDeps {
    return {
      orphanBuffer: this.orphanBuffer,
      processLocalMessage: (m: unknown) => this.processLocalMessage(m),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private broadcastToAll(message: Record<string, unknown>): void {
    instanceChannel.broadcast(message);
    this.processLocalMessage(message);
  }

  private processLocalMessage(message: unknown): void {
    emitLocal(message); // holds P2P traffic until something can receive it
  }

  routeToInstance(targetInstanceId: string, message: unknown): void {
    if (targetInstanceId === instanceManager.instanceId) {
      this.processLocalMessage(message);
    } else {
      instanceChannel.forwardToInstance(targetInstanceId, message);
    }
  }

  isRouterActive(): boolean {
    return instanceManager.isLeader;
  }
}

// Export singleton instance + class (the latter for testing).
export const instanceInboundRouter: InstanceInboundRouter = InstanceInboundRouter.getInstance();
export { InstanceInboundRouter };
