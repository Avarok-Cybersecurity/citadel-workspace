/**
 * P2P Auto-Connect Service State
 *
 * Connection state tracking: connectedPeers Map, online peers, ready channels,
 * pending connections, and connection attempts. This is the single source of truth
 * for peer connection state in the frontend.
 *
 * Delegates to P2PConnectionState from p2p-auto-connect module for core Map operations,
 * and adds service-level state (ready channels, online status refresh, force initiator).
 */

import { P2PConnectionState } from '../p2p-auto-connect/tracking';
import type { ConnectionAttempt } from '@/lib/p2p-auto-connect/types';
import type { PeerConnectionInfo } from './types';

/**
 * Encapsulates all mutable state for the P2PAutoConnectService.
 * The service class holds one instance and passes it to standalone functions.
 */
export class AutoConnectState {
  /** Core connection state (SSOT for connectedPeers, pending, attempts, online) */
  readonly core: P2PConnectionState = new P2PConnectionState();

  /**
   * Channels that have proven bidirectional message flow.
   * A channel is "ready" when we receive the first P2P message from the peer,
   * proving the channel is established and messages can flow in both directions.
   * Reset on session reconnection (ClaimSession/Login).
   */
  readonly readyChannels: Set<bigint> = new Set<bigint>();

  /** Periodic polling interval handle for connection attempts */
  pollingInterval: NodeJS.Timeout | null = null;

  /** Periodic polling interval handle for GetSessions (backend state sync) */
  backendPollInterval: NodeJS.Timeout | null = null;

  /** Guard to prevent concurrent refresh operations */
  isRefreshing: boolean = false;

  // ----- Delegating accessors for common core operations -----

  setPeerConnectedLocal(localCid: bigint, peerCid: bigint): void {
    this.core.setPeerConnectedLocal(localCid, peerCid);
  }

  setPeerDisconnected(localCid: bigint, peerCid: bigint): void {
    this.core.setPeerDisconnected(localCid, peerCid);
    // A dropped link is no longer a usable channel; the next proof of one is news again.
    this.readyChannels.delete(peerCid);
  }

  getPeersForSession(localCid: bigint): bigint[] {
    return this.core.getPeersForSession(localCid);
  }

  isPeerConnectedForSession(localCid: bigint, peerCid: bigint): boolean {
    return this.core.isPeerConnectedForSession(localCid, peerCid);
  }

  getPeerConnectionInfo(localCid: bigint, peerCid: bigint): PeerConnectionInfo | null {
    return this.core.getPeerConnectionInfo(localCid, peerCid);
  }

  isPeerOnline(peerCid: bigint): boolean {
    return this.core.isPeerOnline(peerCid);
  }

  /** Online status, or null when no poll has landed yet. */
  peerOnlineStatus(peerCid: bigint): boolean | null {
    return this.core.peerOnlineStatus(peerCid);
  }

  addOnlinePeer(peerCid: bigint): void {
    // Straight to the core's incremental add. This used to rebuild the whole
    // list and call `setOnlinePeers`, which dates the set as if the backend had
    // just answered -- so one registration event made a tab that has never
    // polled report a confident "offline" for everyone else.
    this.core.addOnlinePeer(peerCid);
  }

  getOnlinePeers(): bigint[] {
    return this.core.getOnlinePeers();
  }

  get forceInitiatorMode(): boolean {
    return this.core.forceInitiatorMode;
  }

  set forceInitiatorMode(value: boolean) {
    this.core.forceInitiatorMode = value;
  }

  get onlineStatusAge(): number {
    return this.core.onlineStatusAge;
  }

  hasPendingConnection(peerCid: bigint): boolean {
    return this.core.hasPendingConnection(peerCid);
  }

  addPendingConnection(peerCid: bigint): void {
    this.core.addPendingConnection(peerCid);
  }

  removePendingConnection(peerCid: bigint): void {
    this.core.removePendingConnection(peerCid);
  }

  clearPendingConnections(): void {
    this.core.clearPendingConnections();
  }

  get pendingConnectionCount(): number {
    return this.core.pendingConnectionCount;
  }

  cancelRetry(peerCid: bigint): void {
    this.core.deleteConnectionAttempt(peerCid);
  }

  cancelAllRetries(): void {
    this.core.clearAllConnectionAttempts();
  }

  getConnectionAttempt(peerCid: bigint): ConnectionAttempt | undefined {
    return this.core.getConnectionAttempt(peerCid);
  }

  setConnectionAttempt(peerCid: bigint, attempt: { attempts: number; timeout: NodeJS.Timeout | null }): void {
    this.core.setConnectionAttempt(peerCid, attempt);
  }

  hasConnectionAttempt(peerCid: bigint): boolean {
    return this.core.hasConnectionAttempt(peerCid);
  }

  clearConnectedPeers(localCid: bigint): void {
    this.core.clearConnectedPeers(localCid);
  }

  setOnlinePeers(peerCids: bigint[], unreported: bigint[]): void {
    this.core.setOnlinePeers(peerCids, unreported);
  }

  clearOnlineStatus(): void {
    // Forgotten, not answered: an empty setOnlinePeers is dated as a completed poll, and a
    // follower never polls again, so every peer read "Offline" for the life of the tab.
    this.core.forgetOnlineStatus();
  }

  getPeerMapForSession(localCid: bigint): Map<bigint, PeerConnectionInfo> {
    return this.core.getPeerMapForSession(localCid);
  }
}
