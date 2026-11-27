/**
 * A test notification a member sends from the page (OsNotificationsControl.tsx), and what the
 * browser says became of it: shown (its `show` event), refused (its `error` event, or a throw),
 * or, where only the service worker can show one (Chromium for Android), accepted by it. Nothing
 * beyond what the API reports: a browser can say "shown" while the system itself (macOS System
 * Settings > Notifications, or Focus) keeps it off screen, which the page cannot see.
 */
import { serviceWorkerRegistration } from './browser-notification';

export type TestOutcome = 'shown' | 'accepted' | 'failed';

const TITLE: string = 'Citadel notifications are on';
const OPTIONS: NotificationOptions = { body: 'This is how your notices will arrive on this device.', icon: '/favicon.ico', tag: 'citadel-test-notification' };

async function throughTheServiceWorker(): Promise<TestOutcome> {
  const registration: ServiceWorkerRegistration | undefined = await serviceWorkerRegistration();
  if (registration === undefined) return 'failed';
  return registration.showNotification(TITLE, OPTIONS).then((): TestOutcome => 'accepted', (): TestOutcome => 'failed');
}

export function sendTestNotification(): Promise<TestOutcome> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return Promise.resolve('failed');
  let shown: Notification;
  try {
    shown = new Notification(TITLE, OPTIONS);
  } catch {
    return throughTheServiceWorker();
  }
  return new Promise<TestOutcome>((settle: (outcome: TestOutcome) => void): void => {
    shown.onshow = (): void => settle('shown');
    shown.onerror = (): void => settle('failed');
  });
}
