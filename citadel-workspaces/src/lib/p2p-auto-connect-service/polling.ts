/**
 * P2P Auto-Connect Polling
 *
 * Polling loop logic, online-awareness checking, backend state refresh.
 */

import { connectionManager } from '../connection';
import { wireMapEntries } from '@/lib/wire-map';
import { p2pRegistrationService } from '../p2p-registration-service';
import { instanceManager } from '../multi-instance';
import { POLLING } from '../timeout-constants';
import { ensureBigInt } from '../utils';
import { debugLog } from '@/lib/debug-config';
import type { AutoConnectState } from './state';
import { ONLINE_STATUS_CACHE_TTL_MS, POLL_INTERVAL_MS } from './constants';
import { getCurrentCid } from './cid-resolver';
import { linkAdmitted } from './pause-gate';
import { supervision } from '../agent-conversations/capabilities';
import type { PeerConnectionInfo } from '@/lib/p2p-auto-connect/types';
import type { PeerInfoResponse } from '@/lib/p2p-registration-service/types';
import type { ActiveSession } from '@/types/session-types';

/**
 * Start periodic GetSessions polling for backend state sync.
 * Only runs on leader tab to prevent redundant backend queries.
 */
export function startBackendPolling(state: AutoConnectState): void {
  if (!instanceManager.isLeader) {
    debugLog('P2PAutoConnectService', '[P2PAutoConnect] Backend polling not started (not leader tab)');
    return;
  }

  if (state.backendPollInterval) {
    return; // Already running
  }

  debugLog('P2PAutoConnectService', `[P2PAutoConnect] Starting backend polling (interval: ${POLLING.GET_SESSIONS_POLL_INTERVAL_MS}ms)`);

  state.backendPollInterval = setInterval(async () => {
    if (state.isRefreshing) return;

    const currentCid: bigint | null = await getCurrentCid();
    if (!currentCid || currentCid === 0n) return;

    state.isRefreshing = true;
    try {
      await refreshFromBackend(state, currentCid);
    } finally {
      state.isRefreshing = false;
    }
  }, POLLING.GET_SESSIONS_POLL_INTERVAL_MS);
}

/** Stop periodic GetSessions polling. */
export function stopBackendPolling(state: AutoConnectState): void {
  if (state.backendPollInterval) {
    clearInterval(state.backendPollInterval);
    state.backendPollInterval = null;
    debugLog('P2PAutoConnectService', '[P2PAutoConnect] Stopped backend polling');
  }
}

/**
 * Refresh peer connection state from backend GetSessions response.
 * MERGES backend data with event-based connections (additive, not replacement).
 * Connections are only removed via explicit PeerDisconnect events.
 */
export async function refreshFromBackend(state: AutoConnectState, localCid: bigint): Promise<void> {
  try {
    const localCidBigInt: bigint = ensureBigInt(localCid);
    const sessions: ActiveSession[] = await connectionManager.getActiveSessions();
    const mySession: ActiveSession | undefined = sessions.find(s => s.cid === localCidBigInt);

    const existingPeerMap: Map<bigint, PeerConnectionInfo> = state.getPeerMapForSession(localCidBigInt);

    if (!mySession?.peer_connections) {
      return; // Preserve existing event-based connections
    }

    const now: number = Date.now();
    // wireMapEntries, not Object.entries. peer_connections is a Rust HashMap,
    // which serde-wasm-bindgen delivers as a JS Map (maps-as-objects is not
    // enabled) while ts-rs declares Record<string, T> -- so Object.entries
    // returns [] and this loop body never ran. The fix was found and applied in
    // p2p-registration-service/connection.ts and not carried here, so
    // refreshFromBackend silently merged nothing.
    for (const [peerCidStr] of wireMapEntries<{ peer_username?: string }>(
      mySession.peer_connections,
      'peer_connections',
    )) {
      const peerCidBigInt: bigint = BigInt(peerCidStr);
      // The agent listing a paused pair does not make it connected here.
      if (!(await linkAdmitted(localCidBigInt, peerCidBigInt))) continue;
      const existingInfo: PeerConnectionInfo | undefined = existingPeerMap.get(peerCidBigInt);

      existingPeerMap.set(peerCidBigInt, {
        peerCid: peerCidBigInt,
        connectedAt: existingInfo?.connectedAt || now,
        lastVerified: now,
        route: existingInfo?.route ?? null,
      });
    }
  } catch (error) {
    const errMsg: string = String(error);
    if (!errMsg.includes('CID 0') && !errMsg.includes('No active')) {
      debugLog('P2PAutoConnectService', 'Backend poll failed:', error);
    }
  }
}

/**
 * Refresh online status from internal service (with caching).
 * @param force - If true, bypass cache and force refresh
 */
export async function refreshOnlineStatus(state: AutoConnectState, force: boolean = false): Promise<void> {
  if (!force && state.onlineStatusAge < ONLINE_STATUS_CACHE_TTL_MS) {
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Using cached online status (${Math.round(state.onlineStatusAge / 1000)}s old)`);
    return;
  }

  try {
    const peers: PeerInfoResponse[] = await p2pRegistrationService.listAllPeers();
    const onlineCids: bigint[] = [];
    const unreportedCids: bigint[] = [];

    for (const peer of peers) {
      const cid: bigint | undefined = peer.cid;
      if (!cid) continue;
      // A peer listed without a status is unknown, not offline.
      if (peer.online_status === undefined) unreportedCids.push(cid);
      else if (peer.online_status) onlineCids.push(cid);
    }

    state.setOnlinePeers(onlineCids, unreportedCids);
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Refreshed online status, ${onlineCids.length} peers online`);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    if (errorMessage?.includes('CID 0') || errorMessage?.includes('No active')) {
      return;
    }
    debugLog('P2PAutoConnectService', 'Failed to refresh online status:', error);
  }
}

/**
 * Trigger an immediate poll to connect to all registered peers.
 * Only runs on leader tab.
 * @param connectAll - async function to connect to all registered peers
 */
export function poll(connectAll: () => Promise<void>): void {
  if (!instanceManager.isLeader) {
    debugLog('P2PAutoConnectService', '[P2PAutoConnect] Poll skipped (not leader tab)');
    return;
  }

  connectAll().catch((err) => {
    debugLog('P2PAutoConnectService', 'Poll failed:', err);
  });
}

/** Start periodic background polling for auto-reconnection. Only runs on leader tab. */
export function startPolling(state: AutoConnectState, connectAll: () => Promise<void>): void {
  if (supervision.get() === true) return; // the agent supervises: nothing for a poll to dial
  if (!instanceManager.isLeader) {
    debugLog('P2PAutoConnectService', '[P2PAutoConnect] Polling not started (not leader tab)');
    return;
  }

  if (state.pollingInterval) {
    return; // Already polling
  }

  debugLog('P2PAutoConnectService', `P2PAutoConnect: Starting background polling (interval: ${POLL_INTERVAL_MS / 1000}s)`);
  poll(connectAll);

  state.pollingInterval = setInterval(() => {
    poll(connectAll);
  }, POLL_INTERVAL_MS);
}

/** Stop periodic background polling. */
export function stopPolling(state: AutoConnectState): void {
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
    state.pollingInterval = null;
    debugLog('P2PAutoConnectService', 'P2PAutoConnect: Stopped background polling');
  }
}
