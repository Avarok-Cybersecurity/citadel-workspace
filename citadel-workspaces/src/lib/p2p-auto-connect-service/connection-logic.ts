/**
 * P2P Auto-Connect Connection Logic
 *
 * Connect/disconnect/retry with backoff, peer connection orchestration.
 */

import { websocketService } from '../websocket-service';
import { p2pRegistrationService } from '../p2p-registration-service';
import { ownsSession } from './session-ownership';
import { dialIsBlocked } from './pause-gate';
import { getRegisteredPeersViaGetSessions } from './registered-peers-fallback';
import { eventEmitter } from '../event-emitter';
import { instanceManager } from '../multi-instance';
import { debugLog } from '@/lib/debug-config';
import type { AutoConnectState } from './state';
import { BASE_DELAY_MS, MAX_DELAY_MS, POLL_INTERVAL_MS } from './constants';
import { getCurrentCid } from './cid-resolver';
import { refreshFromBackend, refreshOnlineStatus } from './polling';
import { keepThroughAgent, supervisedByAgent } from '../agent-supervisor/supervised';
import type { PeerConnectionInfo, ConnectionAttempt } from '@/lib/p2p-auto-connect/types';

/**
 * Connect to a single peer with exponential backoff + online check.
 * Uses deterministic initiator selection: higher CID is the initiator.
 * Only runs on leader tab.
 */

export async function connectToPeer(
  state: AutoConnectState,
  peerCid: bigint,
  forceInitiator: boolean = false
): Promise<void> {
  debugLog('P2PAutoConnectService', `connectToPeer: START peerCid=${peerCid?.toString().slice(0, 8)}, forceInitiator=${forceInitiator}`);

  const shouldForceInitiator: boolean = forceInitiator;

  if (!instanceManager.isLeader) {
    debugLog('P2PAutoConnectService', `[P2PAutoConnect] connectToPeer skipped for ${peerCid?.toString().slice(0, 8)} (not leader tab)`);
    return;
  }

  const currentCid: bigint | null = await getCurrentCid();
  if (!currentCid) {
    debugLog('P2PAutoConnectService', 'connectToPeer: ABORT - no currentCid');
    return;
  }

  if (peerCid === currentCid) {
    debugLog('P2PAutoConnectService', 'connectToPeer: SKIP - self connection');
    return;
  }

  // Paused (or unreadable): no dial and no retry left behind. Resume dials
  // again; the periodic poll re-asks an unreadable record.
  if (await dialIsBlocked(currentCid, peerCid)) {
    debugLog('P2PAutoConnectService', `connectToPeer: SKIP - ${peerCid.toString().slice(0, 8)}... is paused`);
    state.cancelRetry(peerCid);
    return;
  }

  // The supervising agent is the only dialler: it is told the peer is wanted (a peer
  // registered a moment ago is otherwise never dialled), and no retry is left behind.
  if (await keepThroughAgent(currentCid, peerCid)) {
    state.cancelRetry(peerCid);
    return;
  }

  // Deterministic initiator selection: higher CID initiates.
  //
  // Single-WebSocket architecture: only the leader tab has a live WS to the
  // internal service, so auto-connect *runs* on the leader. When the leader's
  // own session has the lower CID, the higher-CID peer is the initiator. In
  // the past we returned here and waited for the peer to act — but the peer
  // is a follower tab in the same browser, which can't send PeerConnect
  // directly (no WS). Result: neither side ever opened the channel, and
  // every P2P message after PeerRegister failed.
  //
  // Fix: when the leader's own CID is lower than the peer's CID, the leader
  // sends PeerConnect with `cid = peerCid` and `peer_cid = currentCid` —
  // i.e., it initiates *on behalf of* the higher-CID session through the
  // shared WS. The internal service routes the request to the right session
  // by `cid`. Both same-browser sessions are owned by this WS, so reversing is
  // safe there; across browsers we initiate from our own side.
  let initiatorCid: bigint = currentCid;
  let targetCid: bigint = peerCid;
  if (shouldForceInitiator) {
    debugLog('P2PAutoConnectService', `P2PAutoConnect: FORCE INITIATOR MODE - Client ${currentCid.toString().slice(0, 8)}... forcing PeerConnect to ${peerCid.toString().slice(0, 8)}... (ClaimSession reconnection)`);
  } else if (currentCid < peerCid && ownsSession(peerCid)) {
    // Reverse ONLY when this browser owns the peer's session. The old
    // condition was CID ordering alone, which sent requests naming another
    // connection's session and relied on being refused to learn the peer was
    // connected. The service now refuses those outright — see session-ownership.ts.
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Local CID ${currentCid.toString().slice(0, 8)}... < peer ${peerCid.toString().slice(0, 8)}...; both sessions are ours, initiating from peer side (multi-tab P2P)`);
    initiatorCid = peerCid;
    targetCid = currentCid;
  } else {
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Client ${currentCid.toString().slice(0, 8)}... IS the initiator for ${peerCid.toString().slice(0, 8)}...`);
  }

  if (state.hasPendingConnection(peerCid)) {
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Connection to ${peerCid.toString().slice(0, 8)}... already pending, skipping duplicate`);
    return;
  }
  state.addPendingConnection(peerCid);

  if (state.isPeerConnectedForSession(currentCid, peerCid)) {
    const peerInfo: PeerConnectionInfo | null = state.getPeerConnectionInfo(currentCid, peerCid);
    const connectionAge: number = peerInfo ? Date.now() - peerInfo.connectedAt : Infinity;
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Already connected to ${peerCid.toString().slice(0, 8)}... (${connectionAge}ms old), skipping`);
    state.removePendingConnection(peerCid);
    return;
  }

  const attempt: ConnectionAttempt = state.getConnectionAttempt(peerCid) || { attempts: 0, timeout: null };
  const isOnline: boolean = state.isPeerOnline(peerCid);
  const cacheValid: boolean = state.onlineStatusAge < 10_000;

  if (cacheValid && !isOnline && !shouldForceInitiator) {
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Peer ${peerCid.toString().slice(0, 8)}... offline (cached), scheduling next check`);
    state.removePendingConnection(peerCid);
    attempt.timeout = setTimeout(() => connectToPeer(state, peerCid), POLL_INTERVAL_MS);
    state.setConnectionAttempt(peerCid, attempt);
    return;
  }

  try {
    debugLog('P2PAutoConnectService', `connectToPeer: calling openP2PConnection(${initiatorCid.toString().slice(0, 8)}, ${targetCid.toString().slice(0, 8)})`);
    await websocketService.openP2PConnection(initiatorCid, targetCid);
    debugLog('P2PAutoConnectService', 'connectToPeer: openP2PConnection SUCCESS');
  } catch (error) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Already connected') || errorMessage.includes('already connected')) {
      debugLog('P2PAutoConnectService', `P2PAutoConnect: Peer ${peerCid.toString().slice(0, 8)}... already connected (treating as success)`);
      state.removePendingConnection(peerCid);
      state.cancelRetry(peerCid);
      const cid: bigint | null = await getCurrentCid();
      if (cid) {
        state.setPeerConnectedLocal(cid, peerCid);
      }
      return;
    }

    state.removePendingConnection(peerCid);
    const delay: number = Math.min(BASE_DELAY_MS * Math.pow(2, attempt.attempts), MAX_DELAY_MS);
    attempt.attempts++;
    const nextDelay: number = delay >= MAX_DELAY_MS ? POLL_INTERVAL_MS : delay;

    attempt.timeout = setTimeout(() => connectToPeer(state, peerCid), nextDelay);
    state.setConnectionAttempt(peerCid, attempt);

    debugLog('P2PAutoConnectService',
      `Connect failed for ${peerCid.toString().slice(0, 8)}..., retry in ${nextDelay / 1000}s (attempt ${attempt.attempts})`
    );
  }
}

/**
 * Connect to all registered peers (on startup or after accept).
 */
export async function connectToAllRegisteredPeers(state: AutoConnectState): Promise<void> {
  const currentCid: bigint | null = await getCurrentCid();
  debugLog('P2PAutoConnectService', `connectToAllRegisteredPeers: currentCid=${currentCid?.toString().slice(0, 8) || 'null'}`);

  if (!currentCid || currentCid === 0n) {
    debugLog('P2PAutoConnectService', 'connectToAllRegisteredPeers: SKIPPED - no valid CID');
    return;
  }

  // One read of what the agent holds, so a page loaded mid-heal knows its links; no dialling.
  if (await supervisedByAgent()) {
    await refreshFromBackend(state, currentCid);
    return;
  }

  refreshOnlineStatus(state).catch(err => debugLog('P2PAutoConnectService', 'refreshOnlineStatus failed:', err));

  let registeredPeers: Array<{ cid?: bigint; username?: string }> = [];

  try {
    registeredPeers = await p2pRegistrationService.listRegisteredPeers();
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Found ${registeredPeers.length} registered peers via ListRegisteredPeers`);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    if (errorMessage?.includes('CID 0') || errorMessage?.includes('No active')) {
      return;
    }
    if (errorMessage?.includes('timed out') || errorMessage?.includes('timeout')) {
      debugLog('P2PAutoConnectService', 'P2PAutoConnect: ListRegisteredPeers timed out, falling back to GetSessions...');
      registeredPeers = await getRegisteredPeersViaGetSessions(currentCid);
    } else {
      debugLog('P2PAutoConnectService', 'Failed to list registered peers:', error);
      return;
    }
  }

  const shouldForceInitiator: boolean = state.forceInitiatorMode;

  debugLog('P2PAutoConnectService', `connectToAllRegisteredPeers: launching connections to ${registeredPeers.length} peers, forceInitiator=${shouldForceInitiator}`);
  for (const peer of registeredPeers) {
    const peerCid: bigint | undefined = peer.cid;
    if (peerCid && peerCid !== currentCid) {
      connectToPeer(state, peerCid, shouldForceInitiator).catch((err) => {
        debugLog('P2PAutoConnectService', `Failed to initiate connection to ${peerCid}:`, err);
      });
    }
  }

  if (state.forceInitiatorMode) {
    state.forceInitiatorMode = false;
    debugLog('P2PAutoConnectService', 'P2PAutoConnect: forceInitiatorMode=false (connection attempts launched)');
  }
}

/** Handle successful connection - INSTANT update to single source of truth. */
export function handleConnectionSuccess(
  state: AutoConnectState,
  localCid: bigint,
  peerCid: bigint,
  broadcastPeerConnected: (localCid: bigint, peerCid: bigint) => void
): void {
  broadcastPeerConnected(localCid, peerCid);
  state.removePendingConnection(peerCid);
  state.cancelRetry(peerCid);
  debugLog('P2PAutoConnectService', `P2PAutoConnect: Connected to ${peerCid.toString().slice(0, 8)}...`);
  eventEmitter.emit('p2p-connection-established', { peerCid });
}

/** Handle peer disconnect - INSTANT update to single source of truth. */
export function handlePeerDisconnect(state: AutoConnectState, localCid: bigint, peerCid: bigint): void {
  state.setPeerDisconnected(localCid, peerCid);
  state.removePendingConnection(peerCid);
  debugLog('P2PAutoConnectService', `P2PAutoConnect: Peer ${peerCid.toString().slice(0, 8)}... disconnected`);
  eventEmitter.emit('p2p-connection-lost', { peerCid });
}

/** Clear a peer from connected state (without emitting events). */
export async function clearPeerFromConnected(state: AutoConnectState, peerCid: bigint): Promise<void> {
  const currentCid: bigint | null = await getCurrentCid();
  if (currentCid) {
    state.setPeerDisconnected(currentCid, peerCid);
  }
  state.removePendingConnection(peerCid);
  debugLog('P2PAutoConnectService', `P2PAutoConnect: Cleared stale connection for ${peerCid.toString().slice(0, 8)}...`);
}

// handleIncomingPeerConnect is in ./incoming-connect.ts
