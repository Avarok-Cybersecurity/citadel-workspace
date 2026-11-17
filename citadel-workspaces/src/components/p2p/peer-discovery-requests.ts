import { websocketService } from '@/lib/websocket-service';
import { eventEmitter } from '@/lib/event-emitter';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { wireMapValues, wireMapEntries } from '@/lib/wire-map';
import { debugLog } from '@/lib/debug-config';
import { narrowWebSocketMessage, hasVariant, getVariant } from '@/lib/ws-message-boundary';
import { TIMEOUT } from '@/lib/timeout-constants';
import { shownPresence } from '@/lib/presence';
import type { Peer } from './usePeerDiscovery';
import type { WebSocketMessage } from '@/types/ws-message-types';
import { assertAgentHoldsSession } from '@/lib/p2p-registration-service/session-held-gate';

interface SessionEntry {
  cid: bigint;
  username?: string;
}

/**
 * Mirrors the generated `PeerInformation`: `{ cid, online_status, name, username }`.
 *
 * This declared `full_name` and `is_online`, which do not exist on the wire —
 * both were read as `undefined` on every peer, so the sidebar showed every
 * discovered peer as offline and unnamed. Optional fields kept tsc silent.
 */
interface PeerEntry {
  cid: bigint;
  username?: string | null;
  name?: string | null;
  online_status?: boolean;
}

/**
 * Fallback discovery using GetSessions.
 * Queries the internal service's session map directly.
 */
export async function discoverPeersViaGetSessions(currentCid: bigint | null): Promise<Peer[]> {
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const request: { GetSessions: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: number; }; } = {
    GetSessions: { request_id: requestId, cid: 0 }
  };

  const responsePromise: Promise<{ sessions?: SessionEntry[]; request_id?: string; }> = new Promise<{ sessions?: SessionEntry[]; request_id?: string }>((resolve, reject): void => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      reject(new Error('GetSessions timed out'));
    }, TIMEOUT.SERVER_REQUEST_MS);

    const handleMessage = (raw: unknown): void => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;
      if (hasVariant(message, 'GetSessionsResponse')) {
        const resp: Record<string, unknown> = getVariant(message, 'GetSessionsResponse')!;
        if (resp.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handleMessage);
          resolve(resp as { sessions?: SessionEntry[]; request_id?: string });
        }
      }
    };

    eventEmitter.on('websocket-message', handleMessage);
  });

  await websocketService.sendMessage(request);
  const response: { sessions?: SessionEntry[]; request_id?: string; } = await responsePromise;
  const sessions: SessionEntry[] = response.sessions || [];
  debugLog('PeerDiscoveryModal', 'GetSessions returned', sessions.length, 'sessions');

  return sessions
    .filter((s) => s.cid.toString() !== currentCid?.toString())
    .map((s) => ({
      cid: s.cid.toString(),
      username: s.username || 'Unknown',
      fullName: undefined,
      is_online: shownPresence(s.username, s.cid, true)
    }));
}

/**
 * Load the set of already-registered peer CIDs via ListRegisteredPeers.
 */
export async function fetchRegisteredPeers(currentCid: bigint): Promise<Set<string>> {
  await assertAgentHoldsSession(currentCid);
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  broadcastChannelService.registerRequest(requestId, currentCid);

  const request: { ListRegisteredPeers: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; }; } = {
    ListRegisteredPeers: { request_id: requestId, cid: currentCid }
  };

  const responsePromise: Promise<{ peers?: Record<string, unknown>; request_id?: string; }> = new Promise<{ peers?: Record<string, unknown>; request_id?: string }>((resolve, reject): void => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      broadcastChannelService.clearRequest(requestId);
      reject(new Error('Request timed out'));
    }, 10000);

    const handleMessage = (raw: unknown): void => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;
      if (hasVariant(message, 'ListRegisteredPeersResponse')) {
        const resp: Record<string, unknown> = getVariant(message, 'ListRegisteredPeersResponse')!;
        if (resp.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handleMessage);
          resolve(resp as { peers?: Record<string, unknown>; request_id?: string });
        }
      } else if (hasVariant(message, 'ListRegisteredPeersFailure')) {
        const fail: Record<string, unknown> = getVariant(message, 'ListRegisteredPeersFailure')!;
        if (fail.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handleMessage);
          reject(new Error((fail.message as string) || 'Failed to list registered peers'));
        }
      }
    };

    eventEmitter.on('websocket-message', handleMessage);
  });

  await websocketService.sendMessage(request);
  const response: { peers?: Record<string, unknown>; request_id?: string; } = await responsePromise;

  // Same HashMap-as-Map hazard: an empty set here meant peers who were ALREADY
  // registered were offered for registration again.
  const registered: Set<string> = new Set<string>();
  for (const [peerCid] of wireMapEntries(response.peers, 'peers')) registered.add(peerCid);
  return registered;
}

/**
 * Discover all peers via ListAllPeers request, with GetSessions fallback.
 */
export async function fetchAllPeers(currentCid: bigint): Promise<Peer[]> {
  await assertAgentHoldsSession(currentCid);
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  broadcastChannelService.registerRequest(requestId, currentCid);

  const request: { ListAllPeers: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; }; } = {
    ListAllPeers: { request_id: requestId, cid: currentCid }
  };

  const responsePromise: Promise<{ peer_information?: Record<string, PeerEntry>; request_id?: string; }> = new Promise<{ peer_information?: Record<string, PeerEntry>; request_id?: string }>((resolve, reject): void => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      broadcastChannelService.clearRequest(requestId);
      reject(new Error('Request timed out'));
    }, 10000);

    const handleMessage = (raw: unknown): void => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;
      if (hasVariant(message, 'ListAllPeersResponse')) {
        const resp: Record<string, unknown> = getVariant(message, 'ListAllPeersResponse')!;
        if (resp.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handleMessage);
          resolve(resp as { peer_information?: Record<string, PeerEntry>; request_id?: string });
        }
      } else if (hasVariant(message, 'ListAllPeersFailure')) {
        const fail: Record<string, unknown> = getVariant(message, 'ListAllPeersFailure')!;
        if (fail.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handleMessage);
          reject(new Error((fail.message as string) || 'Failed to list peers'));
        }
      }
    };

    eventEmitter.on('websocket-message', handleMessage);
  });

  await websocketService.sendMessage(request);
  const response: { peer_information?: Record<string, PeerEntry>; request_id?: string; } = await responsePromise;

  // `peer_information` is a Rust HashMap: over the WASM boundary it is a JS Map,
  // and Object.values() on a Map returns [] — so this path found no peers at all
  // and fell through to the GetSessions fallback, which only sees peers on the
  // same internal service.
  const peerList: PeerEntry[] = wireMapValues<PeerEntry>(response.peer_information, 'peer_information');
  return peerList
    .filter((p) => p.cid !== currentCid)
    .map((p) => ({
      cid: p.cid.toString(),
      username: p.username || 'Unknown',
      fullName: p.name ?? undefined,
      is_online: shownPresence(p.username ?? undefined, p.cid, p.online_status ?? false)
    }));
}
