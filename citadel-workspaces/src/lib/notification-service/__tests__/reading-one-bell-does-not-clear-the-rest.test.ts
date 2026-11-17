/**
 * Opening the bell in one session cleared every other session's badges.
 *
 * The panel is correctly CID-scoped — it renders only what belongs to the
 * session it is showing — but its two-second auto-read called the service-wide
 * `markAllAsRead`. So the OrphanSessionsNavbar's per-session unread counts, fed
 * by `getUnreadCountsByCid`, were zeroed by a bell the user opened somewhere
 * else entirely.
 *
 * Worst on the logged-out landing page, where `sessionCid` is null: the panel
 * renders "No notifications", and two seconds later every session's badge is
 * gone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationService } from '../service';

const ALICE: string = '111';
const BOB: string = '222';

function service(): NotificationService {
  const instance: NotificationService = NotificationService.getInstance();
  // A singleton shared across the suite, and there is no clear-all on the
  // public API, so each test removes what it added rather than assuming a
  // fresh instance.
  for (const existing of instance.getNotifications()) {
    instance.removeNotification(existing.id);
  }
  return instance;
}

describe('the bell auto-read', () => {
  let notifications: ReturnType<typeof service>;

  beforeEach(() => {
    notifications = service();
    notifications.addMessageNotification('from someone', 'hi', 'x', 'm1', ALICE);
    notifications.addMessageNotification('from someone', 'hi', 'x', 'm2', BOB);
    // Not session-scoped: a system message belongs to whoever is looking.
    notifications.addSystemNotification('Update available', 'reload');
  });

  it('clears only the session whose bell was opened', () => {
    notifications.markAllAsReadForCid(ALICE);

    expect((notifications.getUnreadCountsByCid().get(ALICE) ?? 0)).toBe(0);
    expect((notifications.getUnreadCountsByCid().get(BOB) ?? 0)).toBe(1);
  });

  it('leaves other sessions alone from the landing page, where there is no session', () => {
    // sessionCid is null there and the panel shows nothing at all, so this used
    // to clear every badge in the app two seconds after opening an empty bell.
    notifications.markAllAsReadForCid(null);

    expect((notifications.getUnreadCountsByCid().get(ALICE) ?? 0)).toBe(1);
    expect((notifications.getUnreadCountsByCid().get(BOB) ?? 0)).toBe(1);
  });

  it('marks read exactly what the panel showed, and nothing else', () => {
    // The panel filters with notificationBelongsTo and so does this, so "what
    // was shown" and "what was marked read" cannot disagree.
    const shown: string[] = notifications.getNotificationsForCid(ALICE).map((n) => n.id);

    notifications.markAllAsReadForCid(ALICE);

    const stillUnread: string[] = notifications
      .getNotifications()
      .filter((n) => !n.read)
      .map((n) => n.id);

    for (const id of shown) expect(stillUnread).not.toContain(id);
  });

  it('still offers a genuine sweep for signing out of everything', () => {
    notifications.markAllAsRead();

    expect((notifications.getUnreadCountsByCid().get(ALICE) ?? 0)).toBe(0);
    expect((notifications.getUnreadCountsByCid().get(BOB) ?? 0)).toBe(0);
  });
});
