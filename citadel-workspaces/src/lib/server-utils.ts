import { websocketService } from './websocket-service';
import { failOnSocketLoss } from './websocket/request-response';
import { eventEmitter } from './event-emitter';
import { getRecentServers } from './recent-servers';
import { stringToBytes, bytesToString } from './utils/encoding-utils';
import { debugLog } from '@/lib/debug-config';
import { narrowWebSocketMessage, getVariant } from '@/lib/ws-message-boundary';
import { TIMEOUT } from './timeout-constants';
import type { WebSocketMessage } from '@/types/ws-message-types';
import { wireMapEntries } from '@/lib/wire-map';

/**
 * Server info stored in LocalDB
 */
export interface StoredServer {
  serverAddress: string;
  serverName?: string;
  lastConnected?: number;
}

/**
 * List known servers from LocalDB
 * @param options Options including cid (use "0" for global storage)
 * @returns Promise with servers array
 */
export async function listKnownServers(options: { cid: string }): Promise<{ servers: StoredServer[] }> {
  try {
    // `canSendRequests`, not `getClient()`. A follower tab owns no client by
    // design and would always have taken the localStorage fallback -- serving a
    // possibly stale saved-workspace list with no indication, even though the
    // LocalDB copy was perfectly reachable by proxy through the leader.
    if (!websocketService.canSendRequests()) {
      // Don't try to initialize here - let ConnectionManager handle it
      debugLog('ServerUtils', 'Cannot reach the internal service yet, falling back to localStorage');
      return { servers: getRecentServers() };
    }
    
    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();

    // Create a promise to wait for the response
    return failOnSocketLoss('ListKnownServers', new Promise((resolve, reject) => {
      const timeout: NodeJS.Timeout = setTimeout((): void => {
        eventEmitter.off('websocket-message', handler);
        reject(new Error('List known servers request timed out'));
      }, TIMEOUT.LOCALDB_REQUEST_MS);

      // Set up event listener

      const handler = (raw: unknown): void => {
        const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
        if (!message) return;

        const getAllKVSuccess: Record<string, unknown> | undefined = getVariant(message, 'LocalDBGetAllKVSuccess');
        if (getAllKVSuccess && getAllKVSuccess.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handler);

          // Extract servers from the response.
          //
          // `wireMapEntries`, not `Object.keys`. `LocalDBGetAllKVSuccess.map` is
          // a Rust HashMap, and serde-wasm-bindgen delivers it as a real JS Map
          // whatever the generated `Record<string, T>` says -- so `Object.keys`
          // returned NOTHING, silently, with the compiler agreeing. This
          // function therefore always reported zero known servers while
          // `known_servers` was being written correctly the whole time, and
          // every user retyped the workspace address on every visit.
          //
          // The fix already existed in `local-db-operations.ts`, whose own
          // comment spells out this exact trap, and was never carried here.
          const servers: StoredServer[] = [];

          {
            // Look for server-related keys
            wireMapEntries<unknown>(getAllKVSuccess.map, 'LocalDBGetAllKV.map').forEach(([key, entry]) => {
              if (key.startsWith('server_') || key === 'known_servers') {
                try {
                  const value: unknown = entry;
                  if (Array.isArray(value)) {
                    // If it's a byte array, convert to string
                    const jsonStr: string = bytesToString(value);
                    const parsed: ReturnType<typeof JSON.parse> = JSON.parse(jsonStr);
                    if (Array.isArray(parsed)) {
                      servers.push(...parsed);
                    } else if (parsed.servers) {
                      servers.push(...parsed.servers);
                    }
                  } else if (typeof value === 'object' && value !== null && (value as Record<string, unknown>).servers) {
                    servers.push(...(value as Record<string, unknown>).servers as StoredServer[]);
                  }
                } catch (e) {
                  debugLog('ServerUtils', 'Error parsing server data:', e);
                }
              }
            });
          }

          resolve({ servers });
        } else {
          const getAllKVFailure: Record<string, unknown> | undefined = getVariant(message, 'LocalDBGetAllKVFailure');
          if (getAllKVFailure && getAllKVFailure.request_id === requestId) {
            clearTimeout(timeout);
            eventEmitter.off('websocket-message', handler);
            reject(new Error((getAllKVFailure.message as string) || 'Failed to get known servers'));
          }
        }
      };

      // Listen for WebSocket messages
      eventEmitter.on('websocket-message', handler);

      // Send the request
      const request: { LocalDBGetAllKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; }; } = {
        LocalDBGetAllKV: {
          request_id: requestId,
          cid: BigInt(options.cid || '0'),
          peer_cid: null
        }
      };

      websocketService.sendMessage(request as unknown as Record<string, unknown>)
        .catch(error => {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handler);
          reject(error);
        });
    }));
  } catch (error) {
    debugLog('ServerUtils', 'Error in listKnownServers:', error);
    // Return empty array on error to prevent UI crashes
    return { servers: [] };
  }
}

/**
 * Store a known server in LocalDB
 * @param server Server info to store
 * @param cid Connection ID (use "0" for global storage)
 */
export async function storeKnownServer(server: StoredServer, cid: string = "0"): Promise<void> {
  try {
    if (!websocketService.canSendRequests()) {
      throw new Error('Cannot reach the Citadel agent on this machine');
    }
    
    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();

    // First, get existing servers
    const { servers } = await listKnownServers({ cid });
    
    // Add or update the server
    const existingIndex: number = servers.findIndex(s => s.serverAddress === server.serverAddress);
    if (existingIndex >= 0) {
      servers[existingIndex] = { ...servers[existingIndex], ...server };
    } else {
      servers.push(server);
    }

    // Store back to LocalDB
    return failOnSocketLoss('StoreKnownServer', new Promise((resolve, reject) => {
      const timeout: NodeJS.Timeout = setTimeout((): void => {
        eventEmitter.off('websocket-message', handler);
        reject(new Error('Store known server request timed out'));
      }, TIMEOUT.LOCALDB_REQUEST_MS);

      // Set up event listener

      const handler = (raw: unknown): void => {
        const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
        if (!message) return;

        const setKVSuccess: Record<string, unknown> | undefined = getVariant(message, 'LocalDBSetKVSuccess');
        const setKVFailure: Record<string, unknown> | undefined = getVariant(message, 'LocalDBSetKVFailure');
        if (setKVSuccess && setKVSuccess.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handler);
          resolve();
        } else if (setKVFailure && setKVFailure.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handler);
          reject(new Error((setKVFailure.message as string) || 'Failed to store known server'));
        }
      };

      // Listen for WebSocket messages
      eventEmitter.on('websocket-message', handler);

      // Convert servers array to JSON bytes
      const jsonStr: string = JSON.stringify({ servers });
      const bytes: number[] = stringToBytes(jsonStr);

      // Send the request
      const request: { LocalDBSetKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; key: string; value: number[]; }; } = {
        LocalDBSetKV: {
          request_id: requestId,
          cid: BigInt(cid || '0'),
          peer_cid: null,
          key: 'known_servers',
          value: bytes
        }
      };

      websocketService.sendMessage(request as unknown as Record<string, unknown>)
        .catch(error => {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handler);
          reject(error);
        });
    }));
  } catch (error) {
    debugLog('ServerUtils', 'Error in storeKnownServer:', error);
    throw error;
  }
}

// The localStorage recent-servers fallback lives in recent-servers.ts;
// re-exported so existing import sites keep working.
export { saveRecentServer, getRecentServers } from './recent-servers';
