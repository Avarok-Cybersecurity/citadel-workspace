/**
 * Taking a notification back down when the thing it is about is resolved.
 *
 * Split from `service.ts` to keep that file under the 250-line cap.
 */
import { notificationService } from './index';
import type { Notification } from './types';

/**
 * Remove every notification raised from one source record.
 *
 * `sourceId` is the peer-registration request id. A pending request can be
 * resolved without anyone touching its card: auto-accept answers the request
 * from `p2p-registration-service`, which removes the pending entry and nothing
 * else. The bell then kept an unread HIGH "X wants to connect" with live Accept
 * and Decline buttons for a request that no longer existed — and
 * `removeNotification` was reachable only from the notification UI itself
 * (`NotificationCenter`, `NotificationItem`), so no code path could clear it.
 *
 * Keyed on `sourceId` rather than the peer's CID, so a second and genuinely
 * pending request from the same peer is not swept away with the resolved one.
 */
export function removeNotificationsBySource(sourceId: string): void {
  const doomed: string[] = notificationService
    .getNotifications()
    .filter((notification: Notification) => notification.sourceId === sourceId)
    .map((notification: Notification) => notification.id);
  for (const id of doomed) notificationService.removeNotification(id);
}
