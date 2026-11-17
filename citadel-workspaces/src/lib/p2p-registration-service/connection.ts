/**
 * P2P Registration Service - Connection Lifecycle
 *
 * Handles session sync from GetSessions, auto-accept settings,
 * and accept/decline registration requests.
 */

import type { PendingPeerRequest } from '@/lib/peer-registration-store/types';
import { peerRecord } from './peer-record';
import { websocketService } from '../websocket-service';
import { peerRegistrationStore } from '../peer-registration-store';
import { stringToBytes, bytesToString } from '../utils/encoding-utils';
import { wireMapEntries } from '@/lib/wire-map';
import { debugLog } from '@/lib/debug-config';
import { eventEmitter } from '../event-emitter';
import type { Peer, PeerInfoResponse, PendingRequestEntry } from './types';
import { AUTO_ACCEPT_KEY, RETRY_BACKOFF_MS, DEFAULT_LIST_RETRIES } from './constants';
import { getCurrentCid, listRegisteredPeers } from './discovery';
import { registerPeer } from './registration';
import { afterPeerAccepted } from '@/lib/p2p/after-peer-accepted';
import { isGenuinelyAbsent } from '@/lib/storage/absence';

/**
 * List currently registered peers with retry logic.
 * Reduced retries and backoff to prevent UI freeze.
 */
export async function listRegisteredPeersWithRetry(
  pendingRequests: Map<string, PendingRequestEntry>,
  maxRetries: number = DEFAULT_LIST_RETRIES
): Promise<PeerInfoResponse[]> {
  let lastError: Error | null = null;
  for (let i: number = 0; i < maxRetries; i++) {
    try {
      return await listRegisteredPeers(pendingRequests);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!lastError.message?.includes('timed out')) {
        throw error;
      }
      debugLog('P2PRegistrationService', `ListRegisteredPeers attempt ${i + 1}/${maxRetries} timed out, retrying...`);
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  throw lastError || new Error('ListRegisteredPeers failed after retries');
}

/**
 * Sync peer connections from GetSessions data.
 *
 * Validates cached peer_connections against the server's ListRegisteredPeers
 * before adding them. The server is the source of truth for peer registrations.
 */
export async function syncPeerConnectionsFromSession(
  peerConnections: Record<string, { cid: bigint; peer_cid: bigint; peer_username: string }> | undefined,
  allPeers: Map<bigint, Peer>,
  registeredPeers: Map<bigint, Peer>,
  pendingRequests: Map<string, PendingRequestEntry>
): Promise<void> {
  if (!peerConnections) {
    debugLog('P2PRegistrationService', '[P2P Registration] No peer connections to sync');
    return;
  }

  // peer_connections is a Rust HashMap: a JS Map here, on which Object.keys is
  // []. Cached-peer sync after a reconnect therefore synced nothing.
  const peerEntries: [string, { cid: bigint; peer_cid: bigint; peer_username: string; }][] = wireMapEntries<{ cid: bigint; peer_cid: bigint; peer_username: string }>(
    peerConnections, 'peer_connections',
  );
  const peerCids: string[] = peerEntries.map(([cid]) => cid);
  debugLog('P2PRegistrationService', '[P2P Registration] Syncing peer connections from session:', peerCids);

  let serverPeerCids: Set<bigint> | null = null;
  try {
    const serverPeers: PeerInfoResponse[] = await listRegisteredPeers(pendingRequests);
    serverPeerCids = new Set(
      serverPeers.map(p => p.cid as bigint).filter((c): c is bigint => c !== undefined)
    );
    debugLog('P2PRegistrationService',
      `[P2P Registration] Server has ${serverPeerCids.size} registered peers:`,
      Array.from(serverPeerCids).map(c => c.toString())
    );
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    if (errorMessage?.includes('CID 0') || errorMessage?.includes('No active')) {
      debugLog('P2PRegistrationService', '[P2P Registration] No active session, skipping sync of cached peer data');
      return;
    }
    debugLog('P2PRegistrationService', '[P2P Registration] Failed to validate peers against server, skipping sync:', errorMessage);
    return;
  }

  for (const [peerCidStr, peerInfo] of peerEntries) {
    const peerCid: bigint = BigInt(peerCidStr);

    if (serverPeerCids && !serverPeerCids.has(peerCid)) {
      debugLog('P2PRegistrationService', `[P2P Registration] Skipping stale peer ${peerCid.toString()} (not in server registry)`);
      continue;
    }

    if (registeredPeers.has(peerCid)) {
      debugLog('P2PRegistrationService', `[P2P Registration] Peer ${peerCid.toString()} already registered`);
      continue;
    }

    const peer: Peer = peerRecord(peerCid, peerInfo.peer_username, false);

    allPeers.set(peerCid, peer);
    registeredPeers.set(peerCid, peer);

    debugLog('P2PRegistrationService', `[P2P Registration] Added validated peer from session: ${peerCid.toString()} (${peer.username})`);
    eventEmitter.emit('p2p:peer-registered', { peer });
  }
}

/**
 * Get auto-accept setting from LocalDB.
 * @param cidOverride - Optional CID to use instead of fetching via getCurrentCid().
 */
export async function getAutoAcceptSetting(cidOverride?: bigint): Promise<boolean> {
  try {
    const currentCid: bigint | null = cidOverride ?? await getCurrentCid();
    if (!currentCid || currentCid === 0n) return false;

    const result: { value: number[]; } | null = await websocketService.sendLocalDBGet(currentCid, AUTO_ACCEPT_KEY);
    if (result?.value) {
      const decoded: string = bytesToString(result.value);
      return decoded === 'true';
    }
  } catch (error: unknown) {
    // Both branches return false, and here that is DELIBERATE rather than the
    // usual accident. Elsewhere in this codebase an unreadable preference
    // defaulted to `enabled: true` and silently turned auto-connect back on
    // for somebody who had turned it off; the fix there was to stop guessing.
    //
    // This one fails in the opposite direction. `false` means the incoming
    // registration goes to the pending list, where the user sees it and
    // decides — strictly MORE control, and nothing is lost. Failing open
    // (auto-accepting a peer because a read timed out) is the outcome that
    // could not be undone, so it must not be reachable by accident.
    //
    // The distinction is kept in the log because "your setting is missing" and
    // "your setting could not be read" send a support conversation in
    // different directions, and pinned in a test because a future edit that
    // made a failed read fail OPEN would be a security change disguised as a
    // refactor.
    if (isGenuinelyAbsent(error)) {
      debugLog('P2PRegistrationService', '[P2P] Auto-accept setting not found, using default: false');
    } else {
      debugLog('P2PRegistrationService', 'Failed to get auto-accept setting:', error);
    }
  }
  return false;
}

/**
 * Set auto-accept setting in LocalDB.
 */
export async function setAutoAcceptSetting(autoAccept: boolean): Promise<void> {
  const currentCid: bigint | null = await getCurrentCid();
  if (!currentCid || currentCid === 0n) {
    throw new Error('No active user session');
  }
  try {
    await websocketService.sendLocalDBSet(currentCid, AUTO_ACCEPT_KEY, stringToBytes(String(autoAccept)));
    debugLog('P2PRegistrationService', `[P2P] Auto-accept setting saved: ${autoAccept}`);
  } catch (error) {
    debugLog('P2PRegistrationService', 'Failed to save auto-accept setting:', error);
    throw error;
  }
}

/**
 * Accept a registration request - registers back with the peer.
 */
export async function acceptRegistrationRequest(
  peerCid: bigint,
  peerUsername: string | undefined,
  pendingRequests: Map<string, PendingRequestEntry>,
  registeredPeers?: Map<bigint, Peer>
): Promise<void> {
  const currentCid: bigint | null = await getCurrentCid();
  if (!currentCid || currentCid === 0n) {
    throw new Error('No active user session');
  }
  if (peerCid === currentCid) {
    throw new Error('Cannot register with self');
  }

  debugLog('P2PRegistrationService', `[P2P] Accepting registration from ${peerUsername || peerCid.toString()}`);
  await registerPeer(peerCid, pendingRequests);
  await peerRegistrationStore.removeRequestByPeerCid(peerCid);

  if (registeredPeers) {
    const peer: Peer = registeredPeers.get(peerCid) || peerRecord(peerCid, peerUsername, true);
    registeredPeers.set(peerCid, peer);
  }

  afterPeerAccepted(peerCid, peerUsername);
}

/**
 * Decline a registration request.
 *
 * Delegates to the store, which SENDS the decline. This used to remove the
 * local entry and nothing else -- exactly the bug `declineRequest` records
 * having fixed for itself:
 *
 *   Removing the local entry was the whole of decline, so a declined request
 *   came back every five minutes forever.
 *
 * Two declines with the same meaning, one of them weaker, and the weaker one
 * carried the more obvious name on the more obvious object: it is exported
 * from this service's public index, so it is what a new caller reaches for.
 * Nothing called it, which is the only reason the bug was not live.
 */
export async function declineRegistrationRequest(peerCid: bigint): Promise<void> {
  debugLog('P2PRegistrationService', `[P2P] Declining registration from ${peerCid.toString()}`);
  const pending: PendingPeerRequest[] = await peerRegistrationStore.getPendingRequests();
  const request: PendingPeerRequest | undefined = pending.find((r) => r.peer_cid === peerCid);
  if (request) {
    await peerRegistrationStore.declineRequest(request.id);
  } else {
    // Nothing to answer, but the local entry must still go.
    await peerRegistrationStore.removeRequestByPeerCid(peerCid);
  }
  eventEmitter.emit('p2p:registration-declined', { peerCid });
}
