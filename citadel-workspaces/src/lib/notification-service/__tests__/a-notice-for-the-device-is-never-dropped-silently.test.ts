/**
 * A notice meant for this device, arriving while the browser does not allow notifications, is not
 * dropped without a word: the service holds it (os-permission.ts `heldForTheOs`), which puts the
 * "Allow notifications" control in the bell, and never asks for permission itself (no click).
 * Once allowed, the next one is delivered. A notice kept to the page holds nothing.
 *
 * The real notification service. Stand-ins: the system delivery (recorded, never shown), and the
 * browser's Notification API (fake-notification-api.ts; the OS cannot be driven in CI).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationPriority, NotificationType, type Notification, type OsReach } from '../types';
import { installFakeNotificationApi, type FakeNotificationApi } from './fake-notification-api';

const delivered: string[] = vi.hoisted((): string[] => []);
vi.mock('@/lib/notification-service/os-delivery', () => ({
  lazyOsDelivery: async (n: Notification): Promise<void> => { delivered.push(n.title); },
}));

const { notificationService } = await import('../service');
const { heldForTheOs } = await import('../os-permission');

const raise = (title: string, osReach: OsReach): void => {
  notificationService.addNotification({ type: NotificationType.SYSTEM, priority: NotificationPriority.NORMAL, title, content: 'c', osReach });
};

let api: FakeNotificationApi;
beforeEach(() => { api = installFakeNotificationApi('default'); vi.spyOn(document, 'hasFocus').mockReturnValue(true); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delivered.splice(0); heldForTheOs.set(false); });

describe('a notice for this device without permission', () => {
  it('is held, lighting the bell, and the delivery path never asks', () => {
    raise('Standup in 10 minutes', 'always');
    expect(delivered).toEqual([]);
    expect(heldForTheOs.get()).toBe(true);
    expect(api.asked()).toBe(0);
  });

  it('is held too when the browser blocks notifications', () => {
    api.setPermission('denied');
    raise('Blocked reminder', 'always');
    expect(heldForTheOs.get()).toBe(true);
    expect(delivered).toEqual([]);
  });

  it('holds nothing when it is kept to the page (opposite direction)', () => {
    raise('Page only', 'never');
    raise('Chat in front', 'when-away');
    expect(heldForTheOs.get()).toBe(false);
  });

  it('is delivered once permission is granted', async () => {
    raise('Before', 'always');
    api.setPermission('granted');
    raise('After', 'always');
    await vi.waitFor(() => expect(delivered).toEqual(['After']));
  });
});
