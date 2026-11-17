/**
 * PeerDisconnect: drop one P2P channel, leaving the C2S session up.
 *
 * Split from p2p-operations.ts to keep that module under the file cap when the
 * decline path was added; the request and its matching are unchanged.
 */
import { requestResponse } from './request-response';
import { debugLog, errorLog } from '../debug-config';
import { TIMEOUT } from '../timeout-constants';
import type { P2PConfig } from './p2p-operations';

/**
 * Disconnect from a specific P2P peer.
 * Sends PeerDisconnect request - C2S connection stays active.
 */
export async function disconnectP2P(config: P2PConfig, localCid: bigint, peerCid: bigint): Promise<void> {
  await config.init();

  if (localCid === undefined || localCid === null) {
    throw new Error('Local CID is required to disconnect P2P');
  }

  if (peerCid === undefined || peerCid === null) {
    throw new Error('Peer CID is required to disconnect P2P');
  }

  debugLog('P2POperations', 'Disconnecting P2P connection', { localCid: localCid.toString(), peerCid: peerCid.toString() });

  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const peerDisconnectRequest: { PeerDisconnect: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: bigint; }; } = {
    PeerDisconnect: { request_id: requestId, cid: localCid, peer_cid: peerCid }
  };

  // The resolved value is only `true`; a refusal or timeout rejects, and that rejection is the
  // failure report -- callers (pause-store, the chat's disconnect) surface it.
  await requestResponse<true>({
    request: peerDisconnectRequest, requestId, timeoutMs: TIMEOUT.P2P_DISCONNECT_MS,
    sendRequest: config.sendMessage,
    operationName: 'PeerDisconnect',
    matcher: {
      matchSuccess: (msg) => {
        const r: { PeerDisconnectSuccess?: { request_id: string; }; DisconnectNotification?: { request_id?: string; peer_cid?: bigint; }; } = msg as {
          PeerDisconnectSuccess?: { request_id: string };
          DisconnectNotification?: { request_id?: string; peer_cid?: bigint };
        };
        if (r.PeerDisconnectSuccess?.request_id === requestId) {
          debugLog('P2POperations', 'P2P disconnect successful', { peerCid: peerCid.toString() });
          return true;
        }
        if (r.DisconnectNotification) {
          const n: { request_id?: string; peer_cid?: bigint; } = r.DisconnectNotification;
          if (n.request_id === requestId || n.peer_cid === peerCid) {
            debugLog('P2POperations', 'P2P disconnect notification received', { peerCid: peerCid.toString() });
            return true;
          }
        }
        return undefined;
      },
      matchFailure: (msg) => {
        const r: { PeerDisconnectFailure?: { request_id: string; message?: string; }; } = msg as { PeerDisconnectFailure?: { request_id: string; message?: string } };
        if (r.PeerDisconnectFailure?.request_id === requestId) {
          const error: string = r.PeerDisconnectFailure.message || 'PeerDisconnect failed';
          errorLog('P2P disconnect failed:', error);
          return error;
        }
        return undefined;
      },
    },
  });
}
