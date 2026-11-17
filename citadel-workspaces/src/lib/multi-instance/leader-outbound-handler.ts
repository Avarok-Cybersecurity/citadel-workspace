/**
 * Leader Outbound Handler
 *
 * Processes all outbound messages when this instance is the leader.
 * This is the single point of exit for all WebSocket communication.
 *
 * Flow:
 * 1. Receive outbound request from InstanceChannel (from any instance, including self)
 * 2. Validate sender has a valid instance ID
 * 3. Determine if message requires ILM (reliability layer) or can bypass
 * 4. Send to WebSocket
 * 5. Send ACK back to sender
 *
 * The leader processes ALL outbound messages, even its own.
 * This keeps the code path consistent across all instances.
 */

import { eventEmitter } from '../event-emitter';
import { waitForSocket } from './wait-for-socket';
import { instanceChannel } from './instance-channel';
import { instanceManager } from './instance-manager';
import type { ProxyResponseData } from './outbound-queue-types';
import {
  handleWorkspaceRequestProxy,
  handleOpenMessengerProxy,
  handleEnsureMessengerProxy,
  handleSendP2PMessageProxy,
  handleAgentCapabilitiesProxy,
} from './leader-proxy-handlers';
import { debugLog } from '@/lib/debug-config';
import { requiresILM } from './ilm-policy';
import { wasExecutedByAnotherLeader } from './executed-requests';
import { newerTabIsOpen, onNewerTab } from './tab-staleness';
import { StaleLeaderHandover } from './stale-leader-handover';

interface OutboundRequest {
  requestId: string;
  senderInstanceId: string;
  payload: Record<string, unknown>;
}

class LeaderOutboundHandler {
  private static instance: LeaderOutboundHandler;

  private websocketSendFn: ((message: Record<string, unknown>) => Promise<void>) | null = null;

  private constructor() {
    this.setupEventListeners();
  }

  public static getInstance(): LeaderOutboundHandler {
    if (!LeaderOutboundHandler.instance) {
      LeaderOutboundHandler.instance = new LeaderOutboundHandler();
    }
    return LeaderOutboundHandler.instance;
  }

  private setupEventListeners(): void {
    eventEmitter.on('channel:outbound-request', async (request: OutboundRequest) => {
      await this.handleOutboundRequest(request);
    });

    onNewerTab((): void => this.handover.request());
    eventEmitter.on('instance:leader-changed', (data: { isLeader: boolean; leaderId: string }) => {
      this.handover.cancel();
      if (data.isLeader) {
        debugLog('LeaderOutboundHandler', '[LeaderOutboundHandler] Activated as leader');
      } else {
        debugLog('LeaderOutboundHandler', '[LeaderOutboundHandler] Deactivated (no longer leader)');
      }
    });
  }

  setWebSocketSendFunction(fn: (message: Record<string, unknown>) => Promise<void>): void {
    this.websocketSendFn = fn;
    debugLog('LeaderOutboundHandler', '[LeaderOutboundHandler] WebSocket send function registered');
  }

  /**
   * Request ids currently being executed on behalf of a follower.
   *
   * The proxy handlers ack only AFTER awaiting the operation, so a retry that
   * arrives mid-flight used to start the work a second time — invisible for
   * chat, which the receiver deduplicates by message id, and a duplicated write
   * for anything proxied to the workspace server. Dropped silently rather than
   * error-acked: the original is still running and acks for both.
   */
  private readonly inFlight: Set<string> = new Set<string>();

  private readonly handover: StaleLeaderHandover = new StaleLeaderHandover({
    isLeading: (): boolean => instanceManager.isLeader,
    busy: (): boolean => this.inFlight.size > 0,
    newerTabIsOpen,
    relinquish: (): void => instanceChannel.relinquishLeadership(),
  });

  async handleOutboundRequest(request: OutboundRequest): Promise<void> {
    if (this.inFlight.has(request.requestId)) {
      debugLog(
        'LeaderOutboundHandler',
        `Ignoring duplicate delivery of ${request.requestId}; the original is still running`,
      );
      return;
    }

    // The cross-leader half of the same dedup. A leadership flap leaves two
    // tabs both holding `isLeader` for a moment — the sticky leader keeps it
    // (handleLeaderElection rule 1) while the challenger has already claimed
    // it (tryBecomeLeader) — and the outbound queue's leader-change replay
    // fires at exactly that moment, re-delivering entries the sticky leader is
    // still executing. `inFlight` is per-tab and cannot see those, so a
    // workspace write or a Connect ran twice. Dropped silently for the same
    // reason as above: the leader that claimed the execution acks it.
    if (wasExecutedByAnotherLeader(request.requestId)) {
      debugLog(
        'LeaderOutboundHandler',
        `Ignoring ${request.requestId}; another leader already began executing it`,
      );
      return;
    }

    if (this.handover.pending) {
      debugLog('LeaderOutboundHandler', `Not starting ${request.requestId}: handing over to a newer build`);
      return;
    }
    // The manager's flag, not a copy set by our own listener: the queue's leader-change replay runs
    // in an earlier listener, so the copy said "follower" and a promoted tab refused its own queue.
    if (!instanceManager.isLeader) {
      debugLog('LeaderOutboundHandler', 'Received request but not active (not leader)');
      this.sendAck(request.senderInstanceId, request.requestId, 'error', 'Not leader');
      return;
    }

    if (!this.websocketSendFn) {
      // Waited for briefly rather than failed outright: a just-promoted leader
      // is active before its socket exists, and error-acking there loses a real
      // user operation to a leadership flap. See wait-for-socket.ts.
      const ready: boolean = await waitForSocket(() => this.websocketSendFn);
      if (!ready) {
        debugLog('LeaderOutboundHandler', 'WebSocket send function not set');
        this.sendAck(request.senderInstanceId, request.requestId, 'error', 'WebSocket not ready');
        return;
      }
    }

    this.inFlight.add(request.requestId);
    // Claim the execution to every other tab BEFORE the work starts, not at
    // ack time: the duplicate window is precisely the seconds the work is in
    // flight, and an ack-time claim would leave that window open. A transient
    // leader records this claim (channel-message-dispatch) and refuses the
    // replayed id above.
    instanceChannel.send({
      type: 'request-executed',
      targetInstanceId: '*',
      requestId: request.requestId,
    });
    try {
      if (!this.isValidSender(request.senderInstanceId)) {
        debugLog('LeaderOutboundHandler', `Invalid sender: ${request.senderInstanceId}`);
        this.sendAck(request.senderInstanceId, request.requestId, 'error', 'Invalid sender');
        return;
      }

      // Delegate proxy requests to specialized handlers
      if (request.payload?.__workspaceRequestProxy) {
        await handleWorkspaceRequestProxy(request, this.sendAck.bind(this));
        return;
      }
      if (request.payload?.__openMessengerProxy) {
        await handleOpenMessengerProxy(request, this.sendAck.bind(this));
        return;
      }
      if (request.payload?.__ensureMessengerProxy) {
        await handleEnsureMessengerProxy(request, this.sendAck.bind(this));
        return;
      }
      if (request.payload?.__sendP2PMessageProxy) {
        await handleSendP2PMessageProxy(request, this.sendAck.bind(this));
        return;
      }
      if (request.payload?.__agentCapabilitiesProxy) {
        await handleAgentCapabilitiesProxy(request, this.sendAck.bind(this));
        return;
      }

      const requiresIlm: boolean = requiresILM(request.payload);
      debugLog('LeaderOutboundHandler',
        `[LeaderOutboundHandler] Processing ${request.requestId} from ${request.senderInstanceId} (ILM: ${requiresIlm})`
      );

      // Re-read after the awaits above: a demotion can clear it, and the
      // narrowing from the readiness check no longer holds here.
      const send: ((message: Record<string, unknown>) => Promise<void>) | null = this.websocketSendFn;
      if (!send) {
        this.sendAck(request.senderInstanceId, request.requestId, 'error', 'WebSocket not ready');
        return;
      }

      await send(request.payload);
      this.sendAck(request.senderInstanceId, request.requestId, 'processed');
      debugLog('LeaderOutboundHandler', `[LeaderOutboundHandler] Sent and ACKed ${request.requestId}`);
    } catch (error) {
      const errorMessage: string = error instanceof Error ? error.message : 'Unknown error';
      debugLog('LeaderOutboundHandler', `Failed to process ${request.requestId}:`, error);
      this.sendAck(request.senderInstanceId, request.requestId, 'error', errorMessage);
    } finally {
      this.inFlight.delete(request.requestId);
      this.handover.settle();
    }
  }

  async sendDirect(payload: Record<string, unknown>): Promise<void> {
    if (!this.websocketSendFn) {
      throw new Error('WebSocket send function not set');
    }

    await this.websocketSendFn(payload);
  }

  private isValidSender(senderInstanceId: string): boolean {
    if (!senderInstanceId || senderInstanceId.trim() === '') {
      return false;
    }
    return true;
  }

  private sendAck(
    targetInstanceId: string,
    requestId: string,
    status: 'processed' | 'error',
    error?: string,
    data?: ProxyResponseData
  ): void {
    instanceChannel.sendAck(targetInstanceId, requestId, {
      status,
      error,
      data,
    });
  }

  isHandlerActive(): boolean {
    return instanceManager.isLeader;
  }
}

// Export singleton instance
export const leaderOutboundHandler: LeaderOutboundHandler = LeaderOutboundHandler.getInstance();

// Also export class for testing
export { LeaderOutboundHandler };
