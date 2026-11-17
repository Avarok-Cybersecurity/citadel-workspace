/**
 * P2P Registration Service - Peer Discovery
 *
 * Functions for discovering and listing peers, resolving the current CID,
 * and updating peer maps from backend responses.
 */

import { isPlaceholderName } from '@/lib/peer-display';
import { websocketService } from '../websocket-service';
import { failOnSocketLoss } from '../websocket/request-response';
import { broadcastChannelService } from '../broadcast-channel-service';
import { debugLog, debugEnabled } from '@/lib/debug-config';
import type { InternalServiceRequest } from 'citadel-workspace-client-ts';
import type { Peer, PeerInfoResponse, PendingRequestEntry } from './types';
import { PEER_LIST_TIMEOUT } from './constants';
import { wireMapValues } from '@/lib/wire-map';
import { assertAgentHoldsSession } from './session-held-gate';

// One implementation, in lib/p2p/current-cid. This copy had the same four
// steps and the same 500ms timeout under a different constant name.
import { getCurrentCid } from '../p2p/current-cid';
export { getCurrentCid };

/** Validate that a CID represents an active user session (not the service connection) */
function assertValidSession(cid: bigint | null): asserts cid is bigint {
  if (!cid || cid === 0n) {
    throw new Error('No active user session (CID 0 is service connection)');
  }
}

/**
 * List all available peers in the network.
 */
export async function listAllPeers(
  pendingRequests: Map<string, PendingRequestEntry>
): Promise<PeerInfoResponse[]> {
  const currentCid: bigint | null = await getCurrentCid();
  assertValidSession(currentCid);
  await assertAgentHoldsSession(currentCid);

  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  broadcastChannelService.registerRequest(requestId, currentCid);

  const request: InternalServiceRequest = {
    ListAllPeers: { request_id: requestId, cid: currentCid }
  };

  const responsePromise: Promise<Record<string, unknown>> = new Promise<Record<string, unknown>>((resolve, reject): void => {
    pendingRequests.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        broadcastChannelService.clearRequest(requestId);
        reject(new Error('ListAllPeers request timed out'));
      }
    }, PEER_LIST_TIMEOUT);
  });

  await websocketService.sendMessage(request);
  const response: Record<string, unknown> = await failOnSocketLoss('ListAllPeers', responsePromise);

  // `peer_information` is a Rust HashMap, which arrives as a JS Map — so
  // `Object.values(...)` yielded `[]` with no error. This is the service that
  // feeds the Direct Messages peer list, and its 30s poll then CLEARED the peer
  // map and repopulated it from that empty answer, discarding peers learned from
  // registration events. The header of `wire-map.ts` names this exact class, and
  // `parsePeersResponse` fifty lines below already handles the Map shape: the
  // normalizer existed, was used by the neighbouring function, and was never
  // applied here.
  return wireMapValues<PeerInfoResponse>(response.peer_information, 'peer_information');
}

/**
 * List currently registered peers (single attempt).
 */
export async function listRegisteredPeers(
  pendingRequests: Map<string, PendingRequestEntry>
): Promise<PeerInfoResponse[]> {
  debugLog('P2PRegistrationService', '[P2P] listRegisteredPeers: called');
  const currentCid: bigint | null = await getCurrentCid();
  debugLog('P2PRegistrationService', `[P2P] listRegisteredPeers: currentCid=${currentCid?.toString() ?? 'null'}`);
  assertValidSession(currentCid);
  await assertAgentHoldsSession(currentCid);

  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  broadcastChannelService.registerRequest(requestId, currentCid);

  const request: InternalServiceRequest = {
    ListRegisteredPeers: { request_id: requestId, cid: currentCid }
  };

  const responsePromise: Promise<Record<string, unknown>> = new Promise<Record<string, unknown>>((resolve, reject): void => {
    pendingRequests.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        broadcastChannelService.clearRequest(requestId);
        reject(new Error('ListRegisteredPeers request timed out'));
      }
    }, PEER_LIST_TIMEOUT);
  });

  await websocketService.sendMessage(request);
  const response: Record<string, unknown> = await failOnSocketLoss('ListAllPeers', responsePromise);

  // Guarded: this stringifies the WHOLE peer-list response, on a 30s poll
  // plus every event-driven caller, to hand it to a noop in production.
  if (debugEnabled) {
    debugLog('P2PRegistrationService', '[P2P-ListRegisteredPeers] Raw response:', JSON.stringify(response, (k, v) => typeof v === 'bigint' ? v.toString() : v));
  }

  return parsePeersResponse(response);
}

/**
 * Parse the peers response from ListRegisteredPeers.
 * Handles both Map (BigInt keys) and Object (string keys) formats.
 */
function parsePeersResponse(response: Record<string, unknown>): PeerInfoResponse[] {
  let peersArray: Array<[string, PeerInfoResponse]> = [];

  if (response.peers instanceof Map) {
    debugLog('P2PRegistrationService', '[P2P-ListRegisteredPeers] Processing as Map with', response.peers.size, 'entries');
    (response.peers as Map<unknown, PeerInfoResponse>).forEach((peerInfo, peerCid) => {
      peersArray.push([String(peerCid), peerInfo]);
    });
  } else if (response.peers && typeof response.peers === 'object') {
    debugLog('P2PRegistrationService', '[P2P-ListRegisteredPeers] Processing as Object with', Object.keys(response.peers).length, 'keys');
    peersArray = Object.entries(response.peers) as Array<[string, PeerInfoResponse]>;
  } else {
    debugLog('P2PRegistrationService', '[P2P-ListRegisteredPeers] response.peers is null/undefined/not-object');
  }

  debugLog('P2PRegistrationService', '[P2P-ListRegisteredPeers] Converted peers array length:', peersArray.length);

  return peersArray.map(([peerCid, peerInfo]) => ({
    ...peerInfo,
    cid: BigInt(peerCid),
    username: peerInfo.username || peerInfo.peer_username || peerInfo.name || undefined
  }));
}

/**
 * Update internal peer maps based on list responses.
 * Preserves usernames from PeerRegisterNotification since backend
 * ListRegisteredPeers response often doesn't include usernames.
 */
export function updatePeerMaps(
  allPeersMap: Map<bigint, Peer>,
  registeredPeersMap: Map<bigint, Peer>,
  allPeers: PeerInfoResponse[],
  registeredPeers: PeerInfoResponse[]
): void {
  const preservedUsernames: Map<bigint, string> = new Map<bigint, string>();
  for (const [cid, peer] of allPeersMap) {
    if (!isPlaceholderName(peer.username)) {
      preservedUsernames.set(cid, peer.username);
    }
  }
  for (const [cid, peer] of registeredPeersMap) {
    if (!isPlaceholderName(peer.username)) {
      preservedUsernames.set(cid, peer.username);
    }
  }

  allPeersMap.clear();
  for (const peer of allPeers) {
    const cid: bigint | undefined = peer.cid;
    if (cid !== undefined) {
      const username: string = preservedUsernames.get(cid) || peer.username || 'Unknown';
      allPeersMap.set(cid, {
        cid,
        username,
        fullName: peer.name || username || 'Unknown User',
        isOnline: peer.online_status ?? null,
        isRegistered: false
      });
    }
  }

  registeredPeersMap.clear();
  const registeredCids: Set<bigint> = new Set<bigint>();

  for (const peer of registeredPeers) {
    const cid: bigint | undefined = peer.cid;
    if (cid !== undefined) {
      registeredCids.add(cid);
      const username: string = preservedUsernames.get(cid) || peer.username || 'Unknown';
      const peerInfo: Peer = allPeersMap.get(cid) || {
        cid,
        username,
        fullName: peer.name || username || 'Unknown User',
        isOnline: peer.online_status ?? null,
        isRegistered: true
      };
      peerInfo.isRegistered = true;
      if (preservedUsernames.has(cid)) {
        peerInfo.username = preservedUsernames.get(cid)!;
      }
      registeredPeersMap.set(cid, peerInfo);
    }
  }

  for (const [cid, peer] of allPeersMap) {
    peer.isRegistered = registeredCids.has(cid);
  }
}
