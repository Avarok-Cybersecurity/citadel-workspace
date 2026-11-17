/**
 * P2P Connected Peers State
 *
 * Core connected peers Map management - the SSOT for peer connections.
 * Follows SBIO principle - pure state operations only.
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                        CID LIFECYCLE - CRITICAL INFO                         ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║ CID (Client ID) is a persistent 64-bit identifier assigned per account.      ║
 * ║ Only Register creates a new CID. All reconnection scenarios preserve CID.    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { ensureBigInt, ensureBigIntPair } from '../utils';
import type { PeerConnectionInfo } from './types';
import type { PeerPathReport } from '@/types/ice-servers';
import { debugLog } from '@/lib/debug-config';

export class ConnectedPeersState {
  /**
   * SINGLE SOURCE OF TRUTH for peer connections.
   * Structure: Map<localCid, Map<peerCid, PeerConnectionInfo>>
   */
  protected connectedPeers: Map<bigint, Map<bigint, PeerConnectionInfo>> = new Map<bigint, Map<bigint, PeerConnectionInfo>>();

  // ============================================================================
  // Connected Peers Management
  // ============================================================================

  /**
   * Store peer connection locally (bidirectional).
   * CRITICAL: Ensures CIDs are converted to BigInt for Map operations.
   */
  setPeerConnectedLocal(localCid: bigint, peerCid: bigint): void {
    const now: number = Date.now();
    const [localCidBigInt, peerCidBigInt] = ensureBigIntPair(localCid, peerCid);

    debugLog('P2PAutoConnectState',
      `[ILM-DIAG] setPeerConnectedLocal: INPUT localCid type=${typeof localCid}, peerCid type=${typeof peerCid}`
    );

    // Store forward direction: localCid -> peerCid
    if (!this.connectedPeers.has(localCidBigInt)) {
      this.connectedPeers.set(localCidBigInt, new Map());
    }
    const localPeerMap: Map<bigint, PeerConnectionInfo> = this.connectedPeers.get(localCidBigInt)!;
    // A re-confirmation of the same connection keeps the path it reported.
    localPeerMap.set(peerCidBigInt, {
      peerCid: peerCidBigInt,
      connectedAt: now,
      lastVerified: now,
      route: localPeerMap.get(peerCidBigInt)?.route ?? null,
    });

    // Store reverse direction: peerCid -> localCid (BIDIRECTIONAL)
    if (!this.connectedPeers.has(peerCidBigInt)) {
      this.connectedPeers.set(peerCidBigInt, new Map());
    }
    const peerPeerMap: Map<bigint, PeerConnectionInfo> = this.connectedPeers.get(peerCidBigInt)!;
    peerPeerMap.set(localCidBigInt, {
      peerCid: localCidBigInt,
      connectedAt: now,
      lastVerified: now,
      route: peerPeerMap.get(localCidBigInt)?.route ?? null,
    });

    const allKeys: bigint[] = Array.from(this.connectedPeers.keys());
    debugLog('P2PAutoConnectState',
      `[ILM-DIAG] setPeerConnectedLocal: STORED BIDIRECTIONAL localCid=${localCidBigInt.toString()} <-> peerCid=${peerCidBigInt.toString()} (local peers: ${localPeerMap.size}, peer peers: ${peerPeerMap.size})`
    );
    debugLog('P2PAutoConnectState',
      `[ILM-DIAG] setPeerConnectedLocal: ALL MAP KEYS (${allKeys.length}): ${allKeys.map((k) => `${k.toString().slice(0, 8)}...(type=${typeof k})`).join(', ')}`
    );
  }

  /**
   * Record how the connection reaches the peer (bidirectional). Called with
   * PeerConnectSuccess, so the pair is connected and a missing record is created;
   * a later path change goes through `updateConnectionPath` instead.
   * Dropped with the connection by setPeerDisconnected.
   */
  setConnectionPath(localCid: bigint, peerCid: bigint, route: PeerPathReport): void {
    const [a, b] = ensureBigIntPair(localCid, peerCid);
    const now: number = Date.now();
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const peers: Map<bigint, PeerConnectionInfo> = this.getPeerMapForSession(from);
      const existing: PeerConnectionInfo | undefined = peers.get(to);
      peers.set(to, { peerCid: to, connectedAt: existing?.connectedAt ?? now, lastVerified: now, route });
    }
  }

  /**
   * A path change of a connection this state holds. False, and nothing written,
   * when it holds none: a change is not a connection, and must not make a
   * dropped or paused pair read as connected.
   */
  updateConnectionPath(localCid: bigint, peerCid: bigint, route: PeerPathReport): boolean {
    const [a, b] = ensureBigIntPair(localCid, peerCid);
    if (this.connectedPeers.get(a)?.get(b) === undefined) return false;
    this.setConnectionPath(a, b, route);
    return true;
  }

  /**
   * Remove a peer from the connected state (bidirectional).
   */
  setPeerDisconnected(localCid: bigint, peerCid: bigint): void {
    const [localCidBigInt, peerCidBigInt] = ensureBigIntPair(localCid, peerCid);

    const localPeerMap: Map<bigint, PeerConnectionInfo> | undefined = this.connectedPeers.get(localCidBigInt);
    if (localPeerMap) {
      localPeerMap.delete(peerCidBigInt);
    }

    const peerPeerMap: Map<bigint, PeerConnectionInfo> | undefined = this.connectedPeers.get(peerCidBigInt);
    if (peerPeerMap) {
      peerPeerMap.delete(localCidBigInt);
    }

    debugLog('P2PAutoConnectState',
      `[P2PAutoConnect] setPeerDisconnected: ${localCidBigInt.toString().slice(0, 8)} -X- ${peerCidBigInt.toString().slice(0, 8)} (BIDIRECTIONAL)`
    );
  }

  /**
   * Get peer CIDs for a session.
   */
  getPeersForSession(localCid: bigint): bigint[] {
    const localCidBigInt: bigint = ensureBigInt(localCid);

    const peerMap: Map<bigint, PeerConnectionInfo> | undefined = this.connectedPeers.get(localCidBigInt);
    if (!peerMap) {
      const allCids: bigint[] = Array.from(this.connectedPeers.keys());
      if (allCids.length > 0) {
        debugLog('P2PAutoConnectState',
          `getPeersForSession: NO ENTRY for CID ${localCidBigInt.toString().slice(0, 8)}... (type=${typeof localCid}->${typeof localCidBigInt}), but connectedPeers has entries for: ${allCids.map((c) => `${c.toString().slice(0, 8)}(type=${typeof c})`).join(', ')}`
        );
      }
      return [];
    }
    return Array.from(peerMap.keys());
  }

  isPeerConnectedForSession(localCid: bigint, peerCid: bigint): boolean {
    const [localCidBigInt, peerCidBigInt] = ensureBigIntPair(localCid, peerCid);
    const peerMap: Map<bigint, PeerConnectionInfo> | undefined = this.connectedPeers.get(localCidBigInt);
    return peerMap?.has(peerCidBigInt) ?? false;
  }

  getPeerConnectionInfo(localCid: bigint, peerCid: bigint): PeerConnectionInfo | null {
    const [localCidBigInt, peerCidBigInt] = ensureBigIntPair(localCid, peerCid);
    const peerMap: Map<bigint, PeerConnectionInfo> | undefined = this.connectedPeers.get(localCidBigInt);
    return peerMap?.get(peerCidBigInt) ?? null;
  }

  getPeerMapForSession(localCid: bigint): Map<bigint, PeerConnectionInfo> {
    const localCidBigInt: bigint = ensureBigInt(localCid);
    if (!this.connectedPeers.has(localCidBigInt)) {
      this.connectedPeers.set(localCidBigInt, new Map());
    }
    return this.connectedPeers.get(localCidBigInt)!;
  }

  clearConnectedPeers(localCid: bigint): void {
    const localCidBigInt: bigint = ensureBigInt(localCid);
    this.connectedPeers.set(localCidBigInt, new Map());
  }
}
