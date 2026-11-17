// Frozen protocol-1 copy; see ./provenance.ts. Never edit: it stands for tabs already open.
// Instance Channel (Singleton): coordinates leader election + message handling.
import { eventEmitter } from '../../../../event-emitter';
import { reissueTabId , type TabUserContext } from '@/lib/tab-context';
import { handleOutboundAck } from './channel-messaging';
import { sendToLeader } from '../../../send-to-leader';
import { instanceManager } from '../../../instance-manager';
import { documentNonce, acceptInbound } from '../../../instance-identity';
import { dispatchChannelMessage } from './channel-message-dispatch';
import { type AckResult } from '../../../outbound-queue';
import { debugLog, debugEnabled } from '@/lib/debug-config';
import { describeForwarded } from '@/lib/p2p/message-fingerprint';
import { CHANNEL_NAME, type ChannelMessage } from '../../../channel-types';
import type { LeaderElectionState } from './channel-leader-election';
import {
  relinquishLeadership as relinquish,
  startLeaderElection,
} from './channel-leader-election';
import { replayOutboundRequest } from './channel-messaging';
import { setupPageDepartureHandlers } from '../../../channel-lifecycle';

// Re-export types for consumers
export type { ChannelMessage, ChannelMessageType } from '../../../channel-types';

class InstanceChannel {
  private static instance: InstanceChannel;

  private channel: BroadcastChannel | null = null;
  private electionState: LeaderElectionState;

  private constructor() {
    this.electionState = {
      lastLeaderHeartbeat: 0,
      leaderCheckInterval: null,
      heartbeatInterval: null,
      initTime: Date.now(),
      send: (msg): void => this.send(msg),
    };
    this.initialize();
  }

  public static getInstance(): InstanceChannel {
    if (!InstanceChannel.instance) {
      InstanceChannel.instance = new InstanceChannel();
    }
    return InstanceChannel.instance;
  }

  private initialize(): void {
    if (typeof BroadcastChannel === 'undefined') {
      debugLog('InstanceChannel', 'BroadcastChannel API not supported');
      return;
    }

    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.setupMessageHandler();
      this.setupEventListeners();
      startLeaderElection(this.electionState);
      this.announcePresence();
      setupPageDepartureHandlers(this, window);
      debugLog('InstanceChannel', '[InstanceChannel] Initialized');
    } catch (error) {
      debugLog('InstanceChannel', 'Failed to initialize:', error);
    }
  }

  private setupEventListeners(): void {
    eventEmitter.on('instance:cid-changed', (data: { instanceId: string; cid: bigint | null }) => {
      this.send({ type: 'cid-update', targetInstanceId: '*', payload: { cid: data.cid?.toString() ?? null } });
    });

    // Re-broadcast on leader change so a new leader inherits every
    // follower's CID. Without it, CID-routed notifications drop with
    // `No instance owns CID …` after a handover.
    eventEmitter.on('instance:leader-changed', () => { this.broadcastCid(); this.announcePresence(); });

    // OutboundQueue emits 'outbound-retry' for its timeout retry AND its
    // leader-change replay, and nothing subscribed — so a request in flight
    // when the leader died just failed on the 30s ACK timeout.
    eventEmitter.on('outbound-retry', ({ requestId, payload }: { requestId: string; payload: unknown }) => {
      replayOutboundRequest(requestId, payload, (message) => this.send(message));
    });
  }

  private readonly identityRepair: { reissue: () => string; announce: () => void; } = {
    // Both ids, not just the instance one. sessionStorage is copied on
    // Duplicate Tab, so the twins share the TAB id too -- and every
    // `tab-<id>-*` storage key with it, including the selected session.
    reissue: (): string => {
      reissueTabId();
      return instanceManager.reissueInstanceId();
    },
    announce: (): void => this.send({ type: 'instance-announce' as const, targetInstanceId: '*' }),
  };

  private setupMessageHandler(): void {
    if (!this.channel) return;

    this.channel.onmessage = (event: MessageEvent<ChannelMessage>): void => {
      const message: ChannelMessage = event.data;

      // Gated by DOCUMENT, not instance id — see instance-identity.ts.
      if (!acceptInbound(message, instanceManager.instanceId, this.identityRepair)) return;
      if (!this.isMessageForUs(message)) return;
      this.handleMessage(message);
    };

    this.channel.addEventListener('messageerror', (event: MessageEvent) => {
      debugLog('InstanceChannel', 'Channel error:', event);
    });
  }

  private isMessageForUs(message: ChannelMessage): boolean {
    const target: string = message.targetInstanceId;
    if (target === '*' || target === 'broadcast') return true;
    if (target === 'leader') return instanceManager.isLeader;
    return target === instanceManager.instanceId;
  }

  private handleMessage(message: ChannelMessage): void {
    dispatchChannelMessage(message, this.electionState, () => this.broadcastCid());
  }

  // Some auth paths land the CID in tab-context before instanceManager;
  // the heal must look there too or route-miss recovery is a no-op.
  broadcastCid(): void {
    if (instanceManager.cid) { this.sendCidUpdate(instanceManager.cid); return; }
    // `void` alone satisfies no-floating-promises but does NOT handle rejection:
    // getSelectedUser reads IndexedDB, which throws when storage is unavailable
    // (private mode, denied permission, quota). Without this catch that surfaced
    // as an unhandled rejection. The heal is best effort - log and move on.
    void (async (): Promise<void> => {
      const { getSelectedUser } = await import('../../../../tab-context');
      const tab: TabUserContext | null = await getSelectedUser();
      if (tab?.selectedCid) { instanceManager.setCid(tab.selectedCid); this.sendCidUpdate(tab.selectedCid); }
    })().catch((error) => {
      debugLog('InstanceChannel', 'broadcastCid: could not read the selected tab CID', error);
    });
  }

  private sendCidUpdate(cid: bigint): void {
    this.send({ type: 'cid-update', targetInstanceId: '*', payload: { cid: cid.toString() } });
  }

  requestCidReport(): void { this.send({ type: 'cid-report-request', targetInstanceId: '*' }); }

  // ============ Public Methods ============

  send(message: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'> & { senderInstanceId?: string; timestamp?: number }): void {
    if (!this.channel) {
      debugLog('InstanceChannel', 'Channel not available');
      return;
    }

    const fullMessage: ChannelMessage = {
      ...message,
      senderInstanceId: message.senderInstanceId || instanceManager.instanceId,
      senderDocumentNonce: documentNonce,
      timestamp: message.timestamp || Date.now(),
    };

    try {
      this.channel.postMessage(fullMessage);
    } catch (error) {
      debugLog('InstanceChannel', 'Failed to send message:', error);
    }
  }

  sendToLeader(payload: unknown, requestId?: string): Promise<AckResult> {
    return sendToLeader(this, payload, requestId);
  }

  sendAck(targetInstanceId: string, requestId: string, result: AckResult): void {
    const message: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'> = {
      type: 'outbound-ack' as const,
      targetInstanceId,
      requestId,
      status: result.status,
      error: result.error,
      data: result.data,
    };

    // A tab can be the leader answering its OWN queued request: after a leader
    // dies, a follower holding one wins the election and the replay executes
    // locally. BroadcastChannel never delivers to the posting context, so that
    // ack vanished — the entry survived, checkTimeouts re-fired it every 5s, and
    // each retry re-executed the request, which then reported as failed.
    if (targetInstanceId === instanceManager.instanceId) {
      handleOutboundAck({
        ...message,
        senderInstanceId: instanceManager.instanceId,
        timestamp: Date.now(),
      } as ChannelMessage);
      return;
    }

    this.send(message);
  }

  forwardToInstance(targetInstanceId: string, payload: unknown, requestId?: string): void {
    // Fingerprinted so the hop joins to the receiving tab's processLocalMessage.
    // With `requestId` set the router retains the message until the target tab
    // acks; no ack within the buffer timeout means the leader falls back to
    // processing locally, so a bare BroadcastChannel post can no longer lose it.
    // Guarded: describeForwarded copies the payload and hashes it per byte,
    // and this runs on every leader->follower forward.
    if (debugEnabled) {
      debugLog('InstanceChannel', `[ILM-Router] forward -> ${targetInstanceId} ${describeForwarded(payload)}`);
    }
    this.send({ type: 'inbound-forward', targetInstanceId, payload, requestId });
  }

  /** Confirms a forwarded message reached an attached handler here. */
  sendInboundAck(targetInstanceId: string, requestId: string): void {
    this.send({ type: 'inbound-ack', targetInstanceId, requestId });
  }

  broadcast(payload: unknown): void {
    this.send({ type: 'inbound-forward', targetInstanceId: '*', payload });
  }

  announcePresence(): void {
    debugLog('InstanceChannel', `announcePresence: instanceId=${instanceManager.instanceId}, cid=${instanceManager.cid?.toString()}`);
    this.send({ type: 'instance-announce', targetInstanceId: '*', payload: { cid: instanceManager.cid } });
  }

  /** Give up leadership this tab cannot serve — see relinquishLeadership. */
  relinquishLeadership(): void {
    relinquish(this.electionState);
  }

  announceGoodbye(): void {
    this.send({ type: 'instance-goodbye', targetInstanceId: '*' });
  }

  destroy(): void {
    if (this.electionState.heartbeatInterval) clearInterval(this.electionState.heartbeatInterval);
    if (this.electionState.leaderCheckInterval) clearInterval(this.electionState.leaderCheckInterval);
    this.announceGoodbye();
    if (this.channel) { this.channel.close(); this.channel = null; }
    debugLog('InstanceChannel', '[InstanceChannel] Destroyed');
  }
}

// Export singleton instance
export const instanceChannel: InstanceChannel = InstanceChannel.getInstance();

// Also export class for testing
export { InstanceChannel };
