/**
 * P2P Connection Tracking State
 *
 * Pending connections, connection attempts, online status, and force initiator mode.
 * Extends ConnectedPeersState with tracking capabilities.
 */

import type { ConnectionAttempt } from './types';
import { ConnectedPeersState } from './connected-peers';
import { debugLog } from '@/lib/debug-config';

export class P2PConnectionState extends ConnectedPeersState {
  /**
   * Peers we've initiated connection to (waiting for PeerConnectSuccess)
   */
  private pendingConnections: Set<bigint> = new Set<bigint>();

  /**
   * Connection retry tracking per peer
   */
  private connectionAttempts: Map<bigint, ConnectionAttempt> = new Map<bigint, ConnectionAttempt>();

  /**
   * Online status cache
   */
  private onlinePeers: Set<bigint> = new Set<bigint>();
  /** Listed by the last poll with no online status either way. */
  private unknownPeers: Set<bigint> = new Set<bigint>();
  private lastOnlineStatusRefresh: number = 0;

  /**
   * Force initiator mode - set after ClaimSession to bypass deterministic CID check.
   */
  private _forceInitiatorMode: boolean = false;

  // ============================================================================
  // Pending Connections Management
  // ============================================================================

  hasPendingConnection(peerCid: bigint): boolean {
    return this.pendingConnections.has(peerCid);
  }

  addPendingConnection(peerCid: bigint): void {
    this.pendingConnections.add(peerCid);
  }

  removePendingConnection(peerCid: bigint): void {
    this.pendingConnections.delete(peerCid);
  }

  clearPendingConnections(): void {
    this.pendingConnections.clear();
  }

  get pendingConnectionCount(): number {
    return this.pendingConnections.size;
  }

  // ============================================================================
  // Connection Attempts Management
  // ============================================================================

  getConnectionAttempt(peerCid: bigint): ConnectionAttempt | undefined {
    return this.connectionAttempts.get(peerCid);
  }

  setConnectionAttempt(peerCid: bigint, attempt: ConnectionAttempt): void {
    this.connectionAttempts.set(peerCid, attempt);
  }

  deleteConnectionAttempt(peerCid: bigint): void {
    const attempt: ConnectionAttempt | undefined = this.connectionAttempts.get(peerCid);
    if (attempt?.timeout) {
      clearTimeout(attempt.timeout);
    }
    this.connectionAttempts.delete(peerCid);
  }

  clearAllConnectionAttempts(): void {
    for (const [, attempt] of this.connectionAttempts) {
      if (attempt.timeout) {
        clearTimeout(attempt.timeout);
      }
    }
    this.connectionAttempts.clear();
  }

  hasConnectionAttempt(peerCid: bigint): boolean {
    return this.connectionAttempts.has(peerCid);
  }

  // ============================================================================
  // Online Status Management
  // ============================================================================

  isPeerOnline(peerCid: bigint): boolean {
    return this.onlinePeers.has(peerCid);
  }

  /**
   * Online status as a third answer: `null` until a POLL has landed.
   *
   * `isPeerOnline` answers "is this peer in the online set", and before the
   * first refresh that set is empty -- so every peer read as offline, and the
   * sidebar wrote the word "Offline" beside people who were sitting right
   * there. Absent from an empty set is not evidence of anything.
   *
   * A poll, specifically, and not any write to the set. `addOnlinePeer` used to
   * route through `setOnlinePeers`, which stamps this timestamp -- so a single
   * registration event made an incrementally-built set look like a completed
   * poll. Follower tabs never poll at all (`startBackendPolling` returns early
   * when the tab is not leader), so after one registration they answered a
   * confident `false` for every peer they had not personally added: "Offline"
   * for people who were online, which is the exact sentence this method exists
   * to prevent.
   */
  peerOnlineStatus(peerCid: bigint): boolean | null {
    if (this.lastOnlineStatusRefresh === 0) return null;
    // Listed by the poll with no status: the backend said nothing, which is not "offline".
    if (this.unknownPeers.has(peerCid)) return null;
    return this.onlinePeers.has(peerCid);
  }

  /**
   * A complete answer from the backend: replaces the set and dates it.
   * `unreported` are the peers it listed without saying either way.
   */
  setOnlinePeers(peerCids: bigint[], unreported: bigint[]): void {
    this.onlinePeers.clear();
    for (const cid of peerCids) {
      this.onlinePeers.add(cid);
    }
    this.unknownPeers = new Set<bigint>(unreported);
    this.lastOnlineStatusRefresh = Date.now();
  }

  /**
   * One peer we have just learned about, without claiming to know the rest.
   *
   * Deliberately does NOT stamp `lastOnlineStatusRefresh`: knowing that one
   * peer is online says nothing about anybody else, and pretending otherwise
   * turns "we have not asked" into "they are offline".
   */
  addOnlinePeer(peerCid: bigint): void {
    this.onlinePeers.add(peerCid);
    this.unknownPeers.delete(peerCid);
  }

  /** Back to "not asked yet": empty, and no poll on record. */
  forgetOnlineStatus(): void {
    this.onlinePeers.clear();
    this.unknownPeers.clear();
    this.lastOnlineStatusRefresh = 0;
  }

  getOnlinePeers(): bigint[] {
    return Array.from(this.onlinePeers);
  }

  get onlinePeerCount(): number {
    return this.onlinePeers.size;
  }

  get onlineStatusAge(): number {
    return Date.now() - this.lastOnlineStatusRefresh;
  }

  // ============================================================================
  // Force Initiator Mode
  // ============================================================================

  get forceInitiatorMode(): boolean {
    return this._forceInitiatorMode;
  }

  set forceInitiatorMode(value: boolean) {
    this._forceInitiatorMode = value;
    debugLog('P2PAutoConnectState', `P2PAutoConnect: forceInitiatorMode=${value}`);
  }
}
