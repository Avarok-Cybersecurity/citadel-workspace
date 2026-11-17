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

function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return Promise.race([
    navigator.serviceWorker?.ready,
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), SERVICE_WORKER_READY_TIMEOUT_MS);
    }),
  ]);
}

/**
 * The one delivery path, shared by BOTH permission branches of
 * `showBrowserNotification`.
 *
 * On Chromium for Android the `Notification` constructor THROWS ("Illegal
 * constructor. Use ServiceWorkerRegistration.showNotification() instead")
 * rather than no-opping, so the service-worker surface is tried first and the
 * constructor is the guarded fallback. This used to exist only in the
 * permission-already-granted branch; the branch taken right after
 * `requestPermission()` resolved granted kept its own bare `new Notification`
 * inside a voided promise — so on exactly the platform the guard was written
 * for, the FIRST backgrounded message after the user granted permission threw
 * into the void and showed nothing. One function, so the branches cannot
 * differ again.
 */
async function deliver(notification: AppNotification): Promise<void> {
  const options: NotificationOptions = {
    body: notification.content,
    icon: '/favicon.ico',
    tag: notification.id,
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
 * gated on OS delivery or on the user's permission decision.
 */
export function showBrowserNotification(notification: AppNotification): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    void deliver(notification);
  } else if (Notification.permission !== 'denied') {
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        return deliver(notification);
      }
    });
  }
}
