/**
 * Where an app's notification lands (app-notices.ts `pageAppNotices`): in the page's notification
 * list, from the app by name, for the session this tab acts as; with no session signed in it is
 * not shown, and says so on the console.
 *
 * `getCurrentCid` is replaced: which session a tab acts as is read from the connection and
 * IndexedDB, which this test does not run; the notification service is the page's own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationService } from '@/lib/notification-service/service';
import type { Notification } from '@/lib/notification-service/types';
import { pageAppNotices } from '../app-notices';
import type { AppNotice } from '../runtime/first-party-ports';

const cid: { now: bigint | null; } = vi.hoisted(() => ({ now: null as bigint | null }));
vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint | null> => cid.now }));

const settle = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const NOTICE: AppNotice = { from: 'Calendar', appId: 'net.avarok.calendar', nodeId: 'n-3', title: 'New booking', body: 'Intro with ana' };

afterEach(() => { vi.restoreAllMocks(); });

describe("an app's notification", () => {
  it('is listed for the session the tab acts as, from the app by name', async () => {
    cid.now = 42n;
    pageAppNotices(NOTICE);
    await settle();
    const mine: Notification[] = notificationService.getNotificationsForCid('42').filter((n) => n.title === 'New booking');
    expect(mine.map((n) => [n.content, n.senderName, n.data?.appId, n.data?.nodeId])).toEqual([['Intro with ana', 'Calendar', 'net.avarok.calendar', 'n-3']]);
    expect(notificationService.getNotificationsForCid('7').some((n) => n.title === 'New booking')).toBe(false);
  });

  it('is not shown with no session signed in, and says so', async () => {
    cid.now = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before: number = notificationService.getNotifications().length;
    pageAppNotices({ ...NOTICE, title: 'Nobody' });
    await settle();
    expect(notificationService.getNotifications().length).toBe(before);
    expect(warn).toHaveBeenCalledWith('[apps] Calendar raised a notification with no session signed in; it was not shown');
  });
});
