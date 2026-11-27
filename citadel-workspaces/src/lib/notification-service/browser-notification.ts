import type { Notification as AppNotification } from './types';

/**
 * How long to wait for `navigator.serviceWorker.ready` before giving up on the
 * service-worker surface. That promise NEVER settles on a profile where no
 * service worker registers — dev servers, private browsing, a failed
 * registration — and awaiting it unbounded held the whole delivery path
 * hostage: the constructor fallback below it was unreachable, so every
 * backgrounded-tab notification on those profiles was silently dropped.
 * Exported so tests assert against the real bound rather than a copy of it.
 */
export const SERVICE_WORKER_READY_TIMEOUT_MS: number = 1500;

export function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return Promise.race([
    navigator.serviceWorker?.ready,
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), SERVICE_WORKER_READY_TIMEOUT_MS);
    }),
  ]);
}

/**
 * The one delivery path.
 *
 * On Chromium for Android the `Notification` constructor THROWS ("Illegal
 * constructor. Use ServiceWorkerRegistration.showNotification() instead")
 * rather than no-opping, so the service-worker surface is tried first and the
 * constructor is the guarded fallback. One function, so no branch can keep a
 * bare `new Notification` of its own again.
 */
async function deliver(notification: AppNotification): Promise<void> {
  const options: NotificationOptions = {
    body: notification.content,
    icon: '/favicon.ico',
    // One the agent knows by an id of its own (a reminder it fired) is shown once under it.
    tag: typeof notification.data?.osTag === 'string' ? notification.data.osTag : notification.id,
  };
  try {
    const registration: ServiceWorkerRegistration | undefined =
      await serviceWorkerRegistration();
    if (registration) {
      await registration.showNotification(notification.title, options);
      return;
    }
  } catch {
    // Fall through to the constructor below.
  }
  try {
    new Notification(notification.title, options);
  } catch {
    // No notification surface on this platform; the message itself has
    // already been stored and emitted, so there is nothing to recover.
  }
}

/**
 * Shows an OS-level notification, on whichever surface this platform provides.
 * Fire-and-forget by design: the rest of the notification pipeline is never
 * gated on OS delivery. It never asks for permission: a request made outside a
 * click is ignored by Safari and Firefox, so asking happens only from the
 * page's controls (os-permission.ts), and the service holds a notice that needs
 * it (os-decision.ts) rather than reaching here.
 */
export function showBrowserNotification(notification: AppNotification): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') void deliver(notification);
}
