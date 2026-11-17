/**
 * P2P Registration Service - Main Orchestrator
 *
 * Thin class that owns shared state and delegates to module functions.
 * Preserves the singleton pattern and public API surface.
 *
 * CID LIFECYCLE: CID is PERMANENT per account. Once assigned during C2S
 * registration, it NEVER changes. Login/ClaimSession preserve the same CID.
 * P2P registrations persist by CID pairs across sessions.
 * "Peer already registered" is NOT an error - expected after reconnect.
 */

import { peerRecord } from './peer-record';
import { isPlaceholderName } from '@/lib/peer-display';
import { eventEmitter } from '../event-emitter';
import { instanceManager } from '../multi-instance';
import { getCurrentCid } from '../p2p/current-cid';
import { narrowWebSocketMessage } from '@/lib/ws-message-boundary';
import type { BroadcastStateSyncData, WebSocketMessage } from '@/types/ws-message-types';
import { debugLog } from '@/lib/debug-config';
import type { Peer, PeerInfoResponse, PeerRegistrationOptions, PendingRequestEntry } from './types';
import { POLLING_INTERVAL } from './constants';
import { startPeerPoll, type PeerPoll } from './peer-poll';
import { followReconnect } from './reconnect-pause';
import { connectionManager } from '../connection';
import {
  listAllPeers as doListAllPeers,
  listRegisteredPeers as doListRegisteredPeers,
  updatePeerMaps,
} from './discovery';
import {
  handleWebSocketMessage as routeMessage,
  registerPeer as doRegisterPeer,
  registerUnregisteredPeers as doRegisterUnregisteredPeers,
} from './registration';
import {
  listRegisteredPeersWithRetry as doListRegisteredPeersWithRetry,
  syncPeerConnectionsFromSession as doSyncPeerConnections,
  getAutoAcceptSetting as doGetAutoAcceptSetting,
  setAutoAcceptSetting as doSetAutoAcceptSetting,
  acceptRegistrationRequest as doAcceptRegistration,
  declineRegistrationRequest as doDeclineRegistration,
} from './connection';
import { handleIncomingRegistrationWithCid as doHandleIncomingRegistration } from './incoming-registration';
import { stableLists, type PeerLists } from './peers-snapshot';

export class P2PRegistrationService {
  private static instance: P2PRegistrationService | undefined;
  private isRunning: boolean = false;
  private registeredPeers: Map<bigint, Peer> = new Map<bigint, Peer>();
  private allPeers: Map<bigint, Peer> = new Map<bigint, Peer>();
  private poll: PeerPoll | null = null;
  private pendingRequests: Map<string, PendingRequestEntry> = new Map<string, PendingRequestEntry>();
  private outgoingRegistrations: Set<bigint> = new Set<bigint>();
  private incomingRegistrations: Set<bigint> = new Set<bigint>();

  private constructor() {
    this.setupEventListeners();
  }

  public static getInstance(): P2PRegistrationService {
    return (P2PRegistrationService.instance ??= new P2PRegistrationService());
  }

  private setupEventListeners(): void {
    eventEmitter.on('websocket-message', (raw: unknown) => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;
      routeMessage(message, {
        pendingRequests: this.pendingRequests,
        allPeers: this.allPeers,
        registeredPeers: this.registeredPeers,
        outgoingRegistrations: this.outgoingRegistrations,
        incomingRegistrations: this.incomingRegistrations,
        handleIncomingRegistration: (notificationCid, peerCid, peerUsername) =>
          doHandleIncomingRegistration(notificationCid, peerCid, peerUsername, this.pendingRequests, this.registeredPeers),
      });
      if (this.poll) void followReconnect(this.poll, raw, getCurrentCid);
    });

    // Re-sync as soon as the socket is back, not after the 30s poll (replays start()'s options:
    // re-checking without them would drop autoRegisterAll).
    eventEmitter.on('on-ws-connection-success', async () => {
      if (!this.isRunning) return;
      await this.poll?.runNow();
    });

    eventEmitter.on('broadcast-state-sync', (raw: unknown) => {
      const data: BroadcastStateSyncData = raw as BroadcastStateSyncData;
      if (data?.type === 'registered-peer-update' && !instanceManager.isLeader) {
        const peerCid: string | undefined = data.peerCid as string | undefined;
        const peerUsername: string | undefined = data.peerUsername as string | undefined;
        const isOutgoing: boolean | undefined = data.isOutgoing as boolean | undefined;
        const isIncoming: boolean | undefined = data.isIncoming as boolean | undefined;
        if (peerCid !== undefined) {
          const peerCidBigInt: bigint = BigInt(peerCid);
          debugLog('P2PRegistrationService', `[P2P-SYNC] Follower received registeredPeers update: ${peerCidBigInt.toString().slice(0, 8)}... (${peerUsername ?? ''})`);
          this.setPeerRegisteredLocal(peerCidBigInt, peerUsername || '', isOutgoing, isIncoming);
          const peer: Peer = peerRecord(peerCidBigInt, peerUsername, true);
          eventEmitter.emit('p2p:peer-registered', { peer, isOutgoing, isIncoming, fromBroadcast: true });
        }
      }
    });
  }

  private setPeerRegisteredLocal(peerCid: bigint, peerUsername: string, isOutgoing?: boolean, isIncoming?: boolean): void {
    const peer: Peer = this.allPeers.get(peerCid) || peerRecord(peerCid, peerUsername, true);
    peer.isRegistered = true;
    if (!isPlaceholderName(peerUsername)) {
      peer.username = peerUsername;
      peer.fullName = peerUsername;
    }
    this.registeredPeers.set(peerCid, peer);
    if (!this.allPeers.has(peerCid)) {
      this.allPeers.set(peerCid, peer);
    }
    if (isOutgoing) this.outgoingRegistrations.add(peerCid);
    if (isIncoming) this.incomingRegistrations.add(peerCid);
  }

  // ---- Public API (delegates to module functions) ----

  public async start(options: PeerRegistrationOptions = {}): Promise<void> {
    if (this.isRunning) {
      debugLog('P2PRegistrationService', 'P2P Registration Service already running');
      return;
    }
    // The session from the resolver every P2P path uses, not connectionManager's record,
    // which only a login writes: a reopened or claimed tab had none, startup threw here and
    // the page said "Messaging may be unavailable" over a working session. Marked running
    // before the await so an activation arriving meanwhile cannot start a second poll.
    this.isRunning = true;
    if (!(await getCurrentCid())) {
      this.isRunning = false;
      throw new Error('No active connection. Please connect first.');
    }
    debugLog('P2PRegistrationService', 'Starting P2P Registration Service');
    this.poll = startPeerPoll({
      check: () => this.checkAndRegisterPeers(options),
      currentCid: getCurrentCid,
      activeSessions: () => { connectionManager.invalidateSessionCache(); return connectionManager.getActiveSessionsResult(); },
      onSessionGone: (cid: bigint) => this.sessionGone(cid),
      onError: (error: unknown) => {
        if (!/CID 0|No active/.test(String(error))) debugLog('P2PRegistrationService', 'Error checking and registering peers:', error);
      },
    }, POLLING_INTERVAL);
    await this.poll.runNow();
    // Stopped meanwhile, or the first round found the session gone from the agent.
    if (!this.isRunning) return;
    eventEmitter.emit('p2p:registration-service-started');
  }

  /**
   * The agent no longer holds this tab's session. Not 'registration-service-stopped': that means logout and
   * stops server auto-connect, which is what signs the session back in. The next activation calls start().
   */
  private sessionGone(cid: bigint): void {
    this.isRunning = false;
    this.poll = null;
    eventEmitter.emit('p2p:session-gone-from-agent', { cid });
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.poll?.stop();
    this.poll = null;
    debugLog('P2PRegistrationService', 'Stopped P2P Registration Service');
    eventEmitter.emit('p2p:registration-service-stopped');
  }

  /** One poll round; failures propagate to the poll (see peer-poll.ts). */
  private async checkAndRegisterPeers(options: PeerRegistrationOptions): Promise<void> {
    const allPeers: PeerInfoResponse[] = await doListAllPeers(this.pendingRequests);
    const registeredPeers: PeerInfoResponse[] = await doListRegisteredPeersWithRetry(this.pendingRequests);
    updatePeerMaps(this.allPeers, this.registeredPeers, allPeers, registeredPeers);
    if (options.autoRegisterAll) {
      await doRegisterUnregisteredPeers(this.allPeers, this.pendingRequests);
    }
    eventEmitter.emit('p2p:peers-updated', {
      allPeers: Array.from(this.allPeers.values()),
      registeredPeers: Array.from(this.registeredPeers.values())
    });
  }

  public async listAllPeers(): Promise<PeerInfoResponse[]> {
    return doListAllPeers(this.pendingRequests);
  }

  public async listRegisteredPeersWithRetry(maxRetries: number = 2): Promise<PeerInfoResponse[]> {
    return doListRegisteredPeersWithRetry(this.pendingRequests, maxRetries);
  }

  public async listRegisteredPeers(): Promise<PeerInfoResponse[]> {
    return doListRegisteredPeers(this.pendingRequests);
  }

  public async registerPeer(peerCid: bigint): Promise<void> {
    return doRegisterPeer(peerCid, this.pendingRequests);
  }

  /** A peer round now rather than at the next tick, for a lookup that missed (workspace-peers.ts). */
  public async refreshPeers(): Promise<void> { await this.poll?.runNow(); }

  /** See peers-snapshot.ts: the identity of this result is part of the contract. */
  private peersSnapshot: PeerLists | null = null;

  public getPeers(): PeerLists {
    const next: PeerLists = {
      allPeers: Array.from(this.allPeers.values()),
      registeredPeers: Array.from(this.registeredPeers.values())
    };
    this.peersSnapshot = stableLists(this.peersSnapshot, next);
    return this.peersSnapshot;
  }

  public isPeerRegistered(peerCid: bigint): boolean {
    return this.registeredPeers.has(peerCid);
  }

  public hasOutgoingRegistration(peerCid: bigint): boolean {
    return this.outgoingRegistrations.has(peerCid);
  }

  public getPeerInfo(peerCid: bigint): Peer | undefined {
    return this.allPeers.get(peerCid);
  }

  public async syncPeerConnectionsFromSession(
    peerConnections: Record<string, { cid: bigint; peer_cid: bigint; peer_username: string }> | undefined
  ): Promise<void> {
    return doSyncPeerConnections(peerConnections, this.allPeers, this.registeredPeers, this.pendingRequests);
  }

  public async getAutoAcceptSetting(cidOverride?: bigint): Promise<boolean> {
    return doGetAutoAcceptSetting(cidOverride);
  }

  public async setAutoAcceptSetting(autoAccept: boolean): Promise<void> {
    return doSetAutoAcceptSetting(autoAccept);
  }

  public async acceptRegistrationRequest(peerCid: bigint, peerUsername?: string): Promise<void> {
    return doAcceptRegistration(peerCid, peerUsername, this.pendingRequests, this.registeredPeers);
  }

  public async declineRegistrationRequest(peerCid: bigint): Promise<void> {
    return doDeclineRegistration(peerCid);
  }
}
