import type { Notification } from './types';

/**
 * Unread counts, per session.
 *
 * These feed the OrphanSessionsNavbar's per-session badges, which is why they
 * are worth their own module: the badge a user sees for a workspace they are
 * NOT looking at is the only signal that something happened there, and it was
 * being cleared by a bell opened somewhere else entirely.
 *
 * Notifications with no `recipientCid` are not session-scoped and are counted
 * against no session — they are shown in every panel, and attributing them to
 * one would make its badge wrong for every other.
 */
export function unreadCountFor(notifications: Iterable<Notification>, cid: string): number {
  let count: number = 0;
  for (const notification of notifications) {
    if (!notification.read && notification.recipientCid === cid) count += 1;
  }
  return count;
}

export function unreadCountsByCid(notifications: Iterable<Notification>): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();
  for (const notification of notifications) {
    if (!notification.read && notification.recipientCid) {
      counts.set(notification.recipientCid, (counts.get(notification.recipientCid) ?? 0) + 1);
    }
  }
  return counts;
}
