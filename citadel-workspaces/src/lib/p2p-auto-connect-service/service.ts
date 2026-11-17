/**
 * P2P Auto-Connect Service
 *
 * Thin orchestrator that wires together state, event handlers, polling,
 * and connection logic. See module-level files for implementation details.
 *
 * === SINGLE SOURCE OF TRUTH ===
 * This service maintains the authoritative peer connection state for the frontend.
 * The `connectedPeers` Map (in AutoConnectState) is the single source of truth.
 */
import { broadcastChannelService } from '../broadcast-channel-service';
import { instanceManager } from '../multi-instance';
import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';
import type { PeerConnectionInfo } from './types';
import { PEER_CONNECTED_CHECK_INTERVAL_MS, WAIT_FOR_PEER_TIMEOUT_MS, LISTENER_CLEANUP_BUFFER_MS } from './constants';
import { AutoConnectState } from './state';
import { getCurrentCid } from './cid-resolver';
import { keepThroughAgent } from '../agent-supervisor/supervised';
import { setupEventListeners } from './event-handlers';
import {
  connectToPeer as connectToPeerFn,
  connectToAllRegisteredPeers as connectToAllFn,
  handlePeerDisconnect as handlePeerDisconnectFn,
  clearPeerFromConnected as clearPeerFromConnectedFn,
} from './connection-logic';
import { handleIncomingPeerConnect as handleIncomingPeerConnectFn } from './incoming-connect';
import {
  startPolling, stopPolling, startBackendPolling, stopBackendPolling,
  refreshFromBackend as refreshFromBackendFn,
  refreshOnlineStatus as refreshOnlineStatusFn,
  poll as pollFn,
} from './polling';

export class P2PAutoConnectService {
  private static instance: P2PAutoConnectService;
  private readonly state: AutoConnectState = new AutoConnectState();

  private constructor() {
    const broadcastPeerConnected: (localCid: bigint, peerCid: bigint, peerUsername?: string, localUsername?: string) => void = this.setPeerConnected.bind(this);
    const connectAll: () => Promise<void> = this.connectToAllRegisteredPeers.bind(this);
    setupEventListeners(this.state, broadcastPeerConnected, connectAll);
  }

  public static getInstance(): P2PAutoConnectService {
    if (!P2PAutoConnectService.instance) {
      P2PAutoConnectService.instance = new P2PAutoConnectService();
    }
    return P2PAutoConnectService.instance;
  }

  // === Peer Connection State (SSOT) ===

  public setPeerConnected(localCid: bigint, peerCid: bigint): void {
    this.state.setPeerConnectedLocal(localCid, peerCid);
    if (instanceManager.isLeader) {
      debugLog('P2PAutoConnectService', 'Leader broadcasting connectedPeers update to followers');
      broadcastChannelService.broadcastStateSync({
        type: 'connected-peers-update',
        localCid: localCid.toString(),
        peerCid: peerCid.toString(),
        route: this.state.getPeerConnectionInfo(localCid, peerCid)?.route ?? null,
      }, localCid);
    }
  }

  public setPeerDisconnected(localCid: bigint, peerCid: bigint): void {
    this.state.setPeerDisconnected(localCid, peerCid);
  }

  public getPeersForSession(localCid: bigint): bigint[] {
    return this.state.getPeersForSession(localCid);
  }

  public isPeerConnectedForSession(localCid: bigint, peerCid: bigint): boolean {
    return this.state.isPeerConnectedForSession(localCid, peerCid);
  }

  public getPeerConnectionInfo(localCid: bigint, peerCid: bigint): PeerConnectionInfo | null {
    return this.state.getPeerConnectionInfo(localCid, peerCid);
  }

  // === Online Status ===

  public async refreshOnlineStatus(force: boolean = false): Promise<void> {
    return refreshOnlineStatusFn(this.state, force);
  }

  public isPeerOnline(peerCid: bigint): boolean {
    return this.state.isPeerOnline(peerCid);
  }

  /** Online status, or null when no poll has landed yet. */
  public peerOnlineStatus(peerCid: bigint): boolean | null {
    return this.state.peerOnlineStatus(peerCid);
  }

  public getOnlinePeers(): bigint[] {
    return this.state.getOnlinePeers();
  }

  // === Channel Readiness ===

  public isChannelReady(peerCid: bigint): boolean {
    return this.state.readyChannels.has(peerCid);
  }

  public markChannelReady(peerCid: bigint): void {
    if (!this.state.readyChannels.has(peerCid)) {
      this.state.readyChannels.add(peerCid);
      debugLog('P2PAutoConnectService', `[P2P] Channel ready for peer ${peerCid.toString().slice(0, 8)}... (message received)`);
      eventEmitter.emit('p2p:channel-ready', { peerCid });
    }
  }

  // === Connection Logic Delegates ===

  public async connectToPeer(peerCid: bigint, forceInitiator: boolean = false): Promise<void> {
    return connectToPeerFn(this.state, peerCid, forceInitiator);
  }

  public async connectToAllRegisteredPeers(): Promise<void> {
    return connectToAllFn(this.state);
  }

  public async handleIncomingPeerConnect(notification: { cid?: bigint; peer_cid?: bigint; peer_username?: string }): Promise<void> {
    return handleIncomingPeerConnectFn(this.state, notification, this.setPeerConnected.bind(this));
  }

  public handlePeerDisconnect(localCid: bigint, peerCid: bigint): void {
    handlePeerDisconnectFn(this.state, localCid, peerCid);
  }

  public async clearPeerFromConnected(peerCid: bigint): Promise<void> {
    return clearPeerFromConnectedFn(this.state, peerCid);
  }

  // === Polling Delegates ===

  public startBackendPolling(): void { startBackendPolling(this.state); }
  public stopBackendPolling(): void { stopBackendPolling(this.state); }
  public async refreshFromBackend(localCid: bigint): Promise<void> { return refreshFromBackendFn(this.state, localCid); }
  public poll(): void { pollFn(this.connectToAllRegisteredPeers.bind(this)); }
  public startPolling(): void { startPolling(this.state, this.connectToAllRegisteredPeers.bind(this)); }
  public stopPolling(): void { stopPolling(this.state); }
  public cancelRetry(peerCid: bigint): void { this.state.cancelRetry(peerCid); }
  public cancelAllRetries(): void { this.state.cancelAllRetries(); }

  // === Legacy API (uses current CID from context) ===

  /**
   * Connected, or `null` when we cannot name our own session: connections are
   * keyed by session, so `false` there answers a question nobody could ask.
   */
  public async isPeerConnected(peerCid: bigint): Promise<boolean | null> {
    const currentCid: bigint | null = await getCurrentCid();
    if (!currentCid) return null;
    return this.isPeerConnectedForSession(currentCid, peerCid);
  }

  public async getConnectedPeers(): Promise<bigint[]> {
    const currentCid: bigint | null = await getCurrentCid();
    if (!currentCid) return [];
    return this.getPeersForSession(currentCid);
  }

  // === Connection State Reset ===

  public async resetConnectionState(): Promise<void> {
    const currentCid: bigint | null = await getCurrentCid();
    const peerCount: number = currentCid ? (this.state.getPeersForSession(currentCid).length) : 0;

    debugLog('P2PAutoConnectService', `P2PAutoConnect: Resetting connection state for reconnection`);
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Clearing ${peerCount} connected, ${this.state.pendingConnectionCount} pending`);

    if (currentCid) {
      this.state.clearConnectedPeers(currentCid);
    }
    this.state.clearPendingConnections();
    this.state.cancelAllRetries();
    this.state.clearOnlineStatus();
    debugLog('P2PAutoConnectService', 'P2PAutoConnect: Cleared peer online status cache for reconnection');

    this.state.readyChannels.clear();
    debugLog('P2PAutoConnectService', 'P2PAutoConnect: Cleared channel ready state for reconnection');

    this.state.forceInitiatorMode = true;
    debugLog('P2PAutoConnectService', 'P2PAutoConnect: Connection state reset for reconnection');
  }

  // === Background Connection Helpers ===

  public async ensurePeerConnectedInBackground(peerCid: bigint): Promise<void> {
    const currentCid: bigint | null = await getCurrentCid();
    if (!currentCid || currentCid === peerCid) return;

    if (this.isPeerConnectedForSession(currentCid, peerCid)) {
      debugLog('P2PAutoConnectService', `P2PAutoConnect: Peer ${peerCid.toString().slice(0, 8)}... already connected`);
      return;
    }

    if (await keepThroughAgent(currentCid, peerCid)) return; // the agent dials
    if (this.state.hasConnectionAttempt(peerCid)) {
      debugLog('P2PAutoConnectService', `P2PAutoConnect: Connection attempt already in progress for ${peerCid.toString().slice(0, 8)}...`);
      return;
    }

    debugLog('P2PAutoConnectService', `P2PAutoConnect: Starting background connection to ${peerCid.toString().slice(0, 8)}...`);
    this.connectToPeer(peerCid).catch((err) => {
      debugLog('P2PAutoConnectService', `Background connection failed for ${peerCid.toString().slice(0, 8)}...:`, err);
    });
  }

  public async waitForPeerConnected(peerCid: bigint, timeoutMs: number = WAIT_FOR_PEER_TIMEOUT_MS): Promise<boolean> {
    const currentCid: bigint | null = await getCurrentCid();
    if (!currentCid) return false;

    if (this.isPeerConnectedForSession(currentCid, peerCid)) return true;

    await this.ensurePeerConnectedInBackground(peerCid);

    return new Promise((resolve) => {
      const startTime: number = Date.now();

      const checkInterval: NodeJS.Timeout = setInterval((): void => {
        if (this.isPeerConnectedForSession(currentCid, peerCid)) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          debugLog('P2PAutoConnectService', `Timeout waiting for ${peerCid.toString().slice(0, 8)}... to connect`);
          resolve(false);
        }
      }, PEER_CONNECTED_CHECK_INTERVAL_MS);

      const handler = ({ peerCid: connectedPeerCid }: { peerCid: bigint }): void => {
        if (connectedPeerCid === peerCid) {
          clearInterval(checkInterval);
          eventEmitter.off('p2p-connection-established', handler);
          resolve(true);
        }
      };
      eventEmitter.on('p2p-connection-established', handler);

      setTimeout(() => {
        eventEmitter.off('p2p-connection-established', handler);
      }, timeoutMs + LISTENER_CLEANUP_BUFFER_MS);
    });
  }
}
