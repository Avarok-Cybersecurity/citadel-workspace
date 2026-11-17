/**
 * Taking down the cards for requests that have stopped being pending.
 *
 * Split from `service.ts` to keep that file under the 250-line cap.
 */
import { removeNotificationsBySource } from '../notification-service/remove-by-source';
import type { PendingPeerRequest } from './types';

/**
 * Clear the notification for every request in `previous` that is no longer in
 * `stillPending`.
 *
 * The store raised a notification per incoming request and nothing took it back
 * down. With auto-accept on, both consumers of one `PeerRegisterNotification`
 * run: this store records the request and raises the card, while
 * `p2p-registration-service` accepts it and calls `removeRequestByPeerCid` —
 * which removed the pending entry and left the card standing. The user was left
 * with an unread HIGH "X wants to connect" carrying Accept and Decline for a
 * request that had already been accepted.
 *
 * Called from the two places a pending request is removed, rather than from
 * each of their callers, so a future removal path cannot forget it.
 */
export function clearNotificationsFor(
  previous: PendingPeerRequest[],
  stillPending: PendingPeerRequest[]
): void {
  const remaining: Set<string> = new Set(stillPending.map((request) => request.id));
  for (const request of previous) {
    if (!remaining.has(request.id)) removeNotificationsBySource(request.id);
  }
}
