/**
 * A member who keeps an app's notices to the page gets them in the bell and never in the system's
 * notification centre: the app records the member's choice with the page before it raises one
 * (app-notice-delivery.ts), the page marks the notification in-app only, and the notification
 * service starts no system delivery for it. Another app's notices are untouched.
 *
 * The real sink and notification service. Stand-ins: the session read (which CID this tab acts
 * as), the system delivery itself (recorded, never shown), and `document.hasFocus` (false: a
 * window not in front, the only case a system notification is ever for).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/lib/notification-service/types';

const delivered: Notification[] = vi.hoisted((): Notification[] => []);
vi.mock('@/lib/notification-service/os-delivery', () => ({
  lazyOsDelivery: async (n: Notification): Promise<void> => { delivered.push(n); },
}));
vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 7n }));

const { pageAppNotices } = await import('../app-notices');
const { recordAppNoticeDelivery } = await import('../app-notice-delivery');
const { notificationService } = await import('@/lib/notification-service/service');

const settle = async (): Promise<void> => { for (let i: number = 0; i < 10; i += 1) await Promise.resolve(); };
const raised = (title: string): Notification[] => notificationService.getNotifications().filter((n) => n.title === title);

beforeEach(() => { vi.spyOn(document, 'hasFocus').mockReturnValue(false); });
afterEach(() => { vi.restoreAllMocks(); delivered.splice(0); });

describe("an app's notices", () => {
  it('reach the bell but never the system when the member keeps them to the page', async () => {
    recordAppNoticeDelivery('net.avarok.calendar', false);
    pageAppNotices({ from: 'Calendar', appId: 'net.avarok.calendar', title: 'Quiet standup', body: 'Starts at 9:00' });
    await settle();
    expect(raised('Quiet standup')).toHaveLength(1);
    expect(delivered.map((n) => n.title)).not.toContain('Quiet standup');
  });

  it('reach the system too when the member allows it, and another app is untouched by the choice', async () => {
    recordAppNoticeDelivery('net.avarok.calendar', false);
    recordAppNoticeDelivery('net.avarok.calendar', true);
    pageAppNotices({ from: 'Calendar', appId: 'net.avarok.calendar', title: 'Loud standup', body: 'Starts at 9:00' });
    recordAppNoticeDelivery('com.acme.board', false);
    pageAppNotices({ from: 'Calendar', appId: 'net.avarok.calendar', title: 'Still loud', body: 'Starts at 10:00' });
    await settle();
    expect(delivered.map((n) => n.title)).toEqual(['Loud standup', 'Still loud']);
  });
});
