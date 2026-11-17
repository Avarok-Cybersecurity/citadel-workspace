/**
 * Peer Registration Store - Request Lifecycle
 *
 * Handles incoming request processing, accept/decline flows,
 * outgoing request polling, and resend logic.
 */

import { eventEmitter } from '../event-emitter';
import { websocketService } from '../websocket-service';
import { notificationService, NotificationPriority } from '../notification-service';
import { describeError } from '../describe-error';
import { p2pRegistrationService } from '../p2p-registration-service';
import { sendPeerRegisterRequest, resendPeerRegistration } from '@/lib/p2p/send-peer-registration';
import { afterPeerAccepted } from '@/lib/p2p/after-peer-accepted';
import { debugLog } from '@/lib/debug-config';
import { OUTGOING_RESEND_THRESHOLD_MS } from './constants';
import { hasRequestFromPeer } from './state';
import { waitForAcceptResponse } from './accept-matcher';
import type {
  PendingPeerRequest,
  OutgoingPeerRequest,
  PeerRegisterNotification,
} from './types';
import { markAsDecline } from '../p2p-registration-service/decline-correlation';

/**
 * Create a notification card with accept/decline callbacks
 */
export function createNotificationWithCallbacks(
  request: PendingPeerRequest,
  onAccept: (id: string) => Promise<void>,
  onDecline: (id: string) => Promise<void>
): void {
  // A card whose button failed would go on saying a request is waiting, with
  // nothing to say the press did nothing: the failure is put on the same card list.
  const pressed = (verb: 'accept' | 'decline', action: (id: string) => Promise<void>) => (): void => {
    action(request.id).catch((error: unknown): void => {
      debugLog('PeerRegistrationStore', `${verb} failed:`, error);
      notificationService.addSystemNotification(
        `Could not ${verb} the request from ${request.peer_username}`,
        describeError(error),
        NotificationPriority.HIGH,
        request.cid.toString(),
      );
    });
  };
  notificationService.addPeerRegistrationNotification(
    request.peer_username,
    request.peer_cid.toString(),
    request.id,
    pressed('accept', onAccept),
    pressed('decline', onDecline),
    () => eventEmitter.emit('open-pending-requests-modal'),
    request.cid.toString()
  );
}

/**
 * Process an incoming PeerRegisterNotification.
 * Returns the created PendingPeerRequest or null if rejected (duplicate/invalid).
 */
export function processIncomingNotification(
  pendingRequests: PendingPeerRequest[],
  notification: PeerRegisterNotification
): PendingPeerRequest | null {
  debugLog('PeerRegistrationStore', '[P2P] handleIncomingRequest ENTERED with:', {
    cid: notification.cid?.toString(),
    peer_cid: notification.peer_cid?.toString(),
    peer_username: notification.peer_username
  });

  const peerCid: bigint = notification.peer_cid;
  const peerUsername: string = notification.peer_username || 'Unknown';
  const notificationTargetCid: bigint = notification.cid;

  if (peerCid === undefined) { debugLog('PeerRegistrationStore', 'Invalid notification - missing peer_cid'); return null; }
  if (notificationTargetCid === undefined) { debugLog('PeerRegistrationStore', 'Invalid notification - missing target cid'); return null; }
  if (peerCid === notificationTargetCid) { debugLog('PeerRegistrationStore', 'Ignoring self-notification'); return null; }
  if (hasRequestFromPeer(pendingRequests, peerCid, notificationTargetCid)) {
    debugLog('PeerRegistrationStore', 'Duplicate request from peer', peerCid.toString(), 'to', notificationTargetCid.toString());
    return null;
  }

  const ts: number = Date.now();
  debugLog('PeerRegistrationStore', `Creating request with timestamp ${ts} (${new Date(ts).toISOString()})`);

  return {
    id: crypto.randomUUID(),
    peer_cid: peerCid,
    peer_username: peerUsername,
    timestamp: ts,
    cid: notificationTargetCid,
  };
}

/**
 * Execute the accept flow for a pending request.
 * Sends PeerRegister back to the peer and waits for response.
 */
/**
 * Tell the sender their request was refused.
 *
 * Declining used to remove the local entry and nothing else — the backend's
 * `PeerRegisterRespond { accept: false }` had ZERO callers anywhere in the UI.
 * Two consequences, both permanent:
 *
 * - The sender's outgoing store resends every five minutes forever, and the
 *   recipient's dedup only checks LIVE pending requests, so a declined request
 *   reappeared on their screen every five minutes indefinitely.
 * - The sender sat on a disabled "Awaiting Response…" with no cancel, never
 *   learning they had been declined.
 *
 * Neither side had a way forward except the recipient giving in.
 *
 * Best-effort by design: the local removal must happen whether or not the
 * message goes out, because a decline the user performed and then saw
 * reappear — for a second reason — would be worse than a decline the sender
 * has not yet heard about. The sender's own resend is the backstop.
 */
export async function executeDeclineRequest(request: PendingPeerRequest): Promise<void> {
  if (!request.cid) {
    debugLog('PeerRegistrationStore', 'No active session; declining locally only');
    return;
  }
  await sendRegistrationDecline(request.cid, request.peer_cid);
}

/**
 * Send `PeerRegisterRespond { accept: false }` from session `cid` to `peerCid`.
 * Shared by a decline the user clicks and one their privacy setting makes.
 */
export async function sendRegistrationDecline(cid: bigint, peerCid: bigint): Promise<void> {
  // The service answers a decline with PeerRegisterSuccess, which the
  // registration handler cannot otherwise tell from an acceptance.
  const requestId: string = crypto.randomUUID();
  markAsDecline(requestId);

  try {
    await websocketService.sendMessage({
      PeerRegisterRespond: { request_id: requestId, cid, peer_cid: peerCid, accept: false },
    });
    debugLog('PeerRegistrationStore', 'Declined registration from', peerCid);
  } catch (error) {
    debugLog('PeerRegistrationStore', 'Could not send the decline; removing locally anyway', error);
  }
}

export async function executeAcceptRequest(request: PendingPeerRequest): Promise<void> {
  const currentCid: bigint = request.cid;
  if (!currentCid) throw new Error('No active session - cannot accept registration');

  const registerRequestId: string = crypto.randomUUID();
  debugLog('PeerRegistrationStore', 'acceptRequest waiting for response', { registerRequestId, targetPeerCid: request.peer_cid });

  const responsePromise: Promise<void> = waitForAcceptResponse(registerRequestId, request.peer_cid, currentCid);

  debugLog('PeerRegistrationStore', 'Claiming session', currentCid, 'before sending PeerRegister');
  await websocketService.claimSession(currentCid);
  await sendPeerRegisterRequest(registerRequestId, currentCid, request.peer_cid);
  await responsePromise;

  afterPeerAccepted(request.peer_cid, request.peer_username);
}

/**
 * Process a single outgoing request during poll.
 * Returns 'remove' if the request should be removed, 'updated' if timeLastSent was updated,
 * or 'skip' if no action was taken.
 */
export async function processPollRequest(
  request: OutgoingPeerRequest,
  now: number
): Promise<'remove' | 'updated' | 'skip'> {
  if (p2pRegistrationService.isPeerRegistered(request.toCid)) {
    debugLog('PeerRegistrationStore', `Removing stale request for ${request.peerUsername} - already registered`);
    return 'remove';
  }
  if (!request.toCid) { debugLog('PeerRegistrationStore', 'Removing invalid request without toCid'); return 'remove'; }

  const elapsed: number = now - request.timeLastSent;
  if (elapsed < OUTGOING_RESEND_THRESHOLD_MS) return 'skip';

  debugLog('PeerRegistrationStore', 'Resending request to', request.peerUsername, '(elapsed:', elapsed, 'ms)');

  try {
    await resendPeerRegistration(request);
    request.timeLastSent = Date.now();
    return 'updated';
  } catch (error: unknown) {
    const errorMsg: string = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('already') || errorMsg.includes('duplicate') || errorMsg.includes('exists')) {
      debugLog('PeerRegistrationStore', 'Request already exists in protocol queue, continuing');
      request.timeLastSent = Date.now();
      return 'updated';
    } else if (errorMsg.includes('Ratchet does not exist')) {
      debugLog('PeerRegistrationStore', `Ratchet error for ${request.peerUsername}, removing stale request`);
      return 'remove';
    } else {
      debugLog('PeerRegistrationStore', 'Failed to resend to', request.peerUsername, ':', errorMsg);
      return 'skip';
    }
  }
}
