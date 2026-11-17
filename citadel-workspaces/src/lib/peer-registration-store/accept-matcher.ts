/**
 * Peer Registration Store - Accept Response Matcher
 *
 * Handles the WebSocket response matching logic for accepting peer registrations.
 * Extracted from lifecycle.ts due to the complexity of the multi-variant matching.
 */

import { eventEmitter } from '../event-emitter';
import { failOnSocketLoss } from '../websocket/request-response';
import { debugLog } from '@/lib/debug-config';
import { isAlreadyRegistered } from './already-registered';
import { narrowWebSocketMessage } from '@/lib/ws-message-boundary';
import { TIMEOUT } from '../timeout-constants';
import { toCidKey, type CidLike } from '@/lib/utils/cid-utils';
import type { WebSocketMessage } from '@/types/ws-message-types';

/**
 * Wait for a PeerRegister/PeerConnect response matching the given request.
 * Matches by request_id (primary), peer_cid (fallback), or session notification.
 */
export function waitForAcceptResponse(
  registerRequestId: string,
  targetPeerCid: bigint,
  currentCid: bigint
): Promise<void> {
  const targetKey: string = toCidKey(targetPeerCid);

  return failOnSocketLoss('AcceptPeerRegister', new Promise<void>((resolve, reject) => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      eventEmitter.off('websocket-message', handleMessage);
      reject(new Error('Registration request timed out'));
    }, TIMEOUT.PEER_REGISTER_MS);

    const handleMessage = (raw: unknown): void => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;

      const msg: Record<string, Record<string, unknown> | undefined> = message as Record<string, Record<string, unknown> | undefined>;

      const matchesByRequestId: boolean =
        msg.PeerRegisterSuccess?.request_id === registerRequestId ||
        msg.PeerConnectSuccess?.request_id === registerRequestId;

      const responsePeerCid: unknown =
        msg.PeerRegisterSuccess?.peer_cid ||
        msg.PeerConnectSuccess?.peer_cid ||
        msg.PeerConnectNotification?.peer_cid;
      const responseCid: unknown = msg.PeerConnectNotification?.cid;

      const matchesByPeerCid: boolean = !!targetKey && toCidKey(responsePeerCid as CidLike) === targetKey;
      const matchesByCid: boolean = !!targetKey && toCidKey(responseCid as CidLike) === targetKey;

      const currentKey: string = toCidKey(currentCid);
      const isOurNotification: boolean = !!msg.PeerConnectNotification && !!currentKey &&
        (toCidKey(msg.PeerConnectNotification.cid as CidLike) === currentKey ||
         toCidKey(msg.PeerConnectNotification.peer_cid as CidLike) === currentKey);

      if (msg.PeerRegisterSuccess || msg.PeerConnectSuccess || msg.PeerConnectNotification) {
        debugLog('PeerRegistrationStore', 'Checking response match', {
          messageType: msg.PeerRegisterSuccess ? 'PeerRegisterSuccess' :
                      msg.PeerConnectSuccess ? 'PeerConnectSuccess' : 'PeerConnectNotification',
          matchesByRequestId, matchesByPeerCid, matchesByCid, isOurNotification
        });
      }

      if (matchesByRequestId || matchesByPeerCid || matchesByCid || isOurNotification) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        debugLog('PeerRegistrationStore', 'Registration succeeded', { targetPeerCid });
        resolve();
      } else if (msg.PeerRegisterFailure?.request_id === registerRequestId ||
                 msg.PeerConnectFailure?.request_id === registerRequestId) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        const errorMsg: string = (msg.PeerRegisterFailure?.message as string) ||
                        (msg.PeerConnectFailure?.message as string) || 'Registration failed';
        // "Already registered" is a SUCCESS, and CLAUDE.md says so outright:
        // "attempting to register an already-registered peer is normal. Treat
        // this as success, not failure."
        //
        // The agent answers PeerRegisterFailure for it
        // (requests/peer/register.rs), and three other places in this codebase
        // already special-case it -- p2p-registration-service/registration.ts,
        // lifecycle.ts's stale-request sweep, and the auto-connect service.
        // This accept path did not, so the promise REJECTED, and the caller
        // (lifecycle.ts) awaits it immediately before `connectToPeer`: the
        // rejection skipped the connect entirely.
        //
        // That is the shape of the CI failure. Registrations survive on the
        // backend across reconnects because the CID never changes, so on any
        // re-run, and on all three reconnection legs, Accept met this branch
        // and no P2P channel was ever opened -- which is exactly what the agent
        // log shows: every send `to SERVER (no peer_cid)` and not one
        // `[PeerChannelCreated]`.
        if (isAlreadyRegistered(errorMsg)) {
          debugLog('PeerRegistrationStore',
            'Peer already registered - treating as success', { targetPeerCid });
          resolve();
          return;
        }
        reject(new Error(errorMsg));
      }
    };

    eventEmitter.on('websocket-message', handleMessage);
  }));
}
