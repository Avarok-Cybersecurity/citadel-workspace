/**
 * A reminder the agent fired reaches the bell of the window that runs the member's Calendar work,
 * for that session only (page-agent-reminders.ts, fired-reminders.ts). It goes beyond the list only
 * when the menu-bar app did not show it, and then under the agent's id for it, so the system
 * shows one reminder once; it is never handed back to the agent (owner.ts `fromAgent`).
 *
 * Real wire bus, notification service, browser delivery and reach. Stand-ins: the window's session
 * (getCurrentCid; no signed-in connection in CI) and the browser's Notification API
 * (fake-notification-api.ts; the OS cannot be driven in CI).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppNoticeNotification } from 'citadel-internal-service-wasm-client';
import type { Notification } from '@/lib/notification-service/types';
import type { FakeNotificationApi } from '@/lib/notification-service/__tests__/fake-notification-api';

vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint | null> => 5n }));

const { eventEmitter } = await import('@/lib/event-emitter');
const { notificationService } = await import('@/lib/notification-service/service');
const { showBrowserNotification } = await import('@/lib/notification-service/browser-notification');
const { notificationOwner } = await import('@/lib/notification-service/owner');
const { recordAppNoticeDelivery } = await import('@/lib/citadel-apps/app-notice-delivery');
const { pageAgentReminders } = await import('../page-agent-reminders');
const { firedReminderEntry, firedReminderOf } = await import('../fired-reminders');
const { installFakeNotificationApi } = await import('@/lib/notification-service/__tests__/fake-notification-api');
const { CALENDAR_APP_ID } = await import('../app-id');

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); vi.unstubAllGlobals(); });

function fired(id: string, over: Partial<AppNoticeNotification> = {}, appId: string = CALENDAR_APP_ID): AppNoticeNotification {
  return {
    cid: 5n, late: false, shown_natively: false, request_id: null,
    notice: { id, app_id: appId, node_id: 'n1', title: `Standup ${id}`, body: 'Starts at 9:15 AM', sender_only: undefined, fire_at_ms: 1n, start_ms: 2n },
    ...over,
  };
}

const listedTitles = (id: string): string[] => notificationService.getNotifications().filter((n) => n.title.includes(id)).map((n) => n.title);

async function hear(f: AppNoticeNotification | Record<string, unknown>): Promise<void> {
  eventEmitter.emit('websocket-message', { AppNoticeNotification: f });
  await new Promise((r) => setTimeout(r, 0));
}

describe('a reminder the agent fired', () => {
  it('is listed, from the Calendar, for the session the window acts as', async () => {
    offs.push(pageAgentReminders('Calendar').listFired());
    await hear(fired('r1'));
    const listed: Notification[] = notificationService.getNotifications().filter((n) => n.title === 'Standup r1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ senderName: 'Calendar', recipient_cid: '5', data: { appId: CALENDAR_APP_ID, nodeId: 'n1', fromAgent: true, osTag: 'r1', senderLine: null } });
  });

  it("is not listed for another session's window, nor for another app, nor when malformed", async () => {
    offs.push(pageAgentReminders('Calendar').listFired());
    await hear(fired('r2', { cid: 6n }));
    await hear(fired('r3', {}, 'com.acme.board'));
    await hear({ ...fired('r4'), cid: '5' });
    expect([...listedTitles('r2'), ...listedTitles('r3'), ...listedTitles('r4')]).toEqual([]);
  });

  it('is not listed once the work stops', async () => {
    const off: () => void = pageAgentReminders('Calendar').listFired();
    off();
    await hear(fired('r5'));
    expect(listedTitles('r5')).toEqual([]);
  });

  it('says it was missed when it fired late', () => {
    expect(firedReminderEntry(fired('r6', { late: true }), 'Calendar').title).toBe('Missed: Standup r6');
  });

  it('reaches the system only when the menu-bar app did not show it, as the member chose', () => {
    recordAppNoticeDelivery(CALENDAR_APP_ID, true);
    expect(firedReminderEntry(fired('r7', { shown_natively: true }), 'Calendar').osReach).toBe('never');
    expect(firedReminderEntry(fired('r7'), 'Calendar').osReach).toBe('always');
    recordAppNoticeDelivery(CALENDAR_APP_ID, false);
    expect(firedReminderEntry(fired('r7'), 'Calendar').osReach).toBe('never');
  });

  it('reaches the system under the id the agent knows it by, so it is shown once', async () => {
    const os: FakeNotificationApi = installFakeNotificationApi('granted');
    const entry: Omit<Notification, 'id' | 'timestamp' | 'read'> = firedReminderEntry(fired('reminder:m1:1'), 'Calendar');
    showBrowserNotification({ ...entry, id: 'list-entry-uuid', timestamp: 0, read: false });
    await vi.waitFor(() => expect(os.tags).toEqual(['reminder:m1:1']));
  });

  it('is never handed back to the agent', () => {
    const entry: Omit<Notification, 'id' | 'timestamp' | 'read'> = firedReminderEntry(fired('r8'), 'Calendar');
    expect(notificationOwner(entry, { notifierAttached: true, appNotices: true })).toBe('browser');
  });

  it("carries the agent's sender line when it has one", () => {
    const f: AppNoticeNotification = fired('r9');
    expect(firedReminderOf({ AppNoticeNotification: { ...f, notice: { ...f.notice, sender_only: 'Calendar: new invitation' } } })?.notice.sender_only).toBe('Calendar: new invitation');
    expect(firedReminderOf({ AppNoticeNotification: { ...f, notice: { ...f.notice, sender_only: 7 } } })).toBeNull();
  });
});
