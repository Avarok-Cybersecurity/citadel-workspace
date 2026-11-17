/**
 * OS-level delivery for backgrounded tabs, both platform shapes.
 *
 * Two ways it silently showed nothing:
 *
 * 1. The branch taken right after `requestPermission()` resolved granted kept
 *    its own bare `new Notification` — a second copy of delivery that missed
 *    the Chromium-for-Android fix (the constructor THROWS there), inside a
 *    voided promise that swallowed the throw. The first backgrounded message
 *    after granting permission showed nothing on exactly the platform the
 *    service-worker path exists for.
 *
 * 2. `navigator.serviceWorker.ready` NEVER settles when no service worker
 *    registers (dev, private browsing, failed registration), so an unbounded
 *    await parked delivery forever and made the constructor fallback
 *    unreachable.
 *
 * jsdom cannot prove the real Android constructor throws or that a real
 * `ready` hangs — these tests encode that documented platform behavior in
 * stubs and prove OUR code survives it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  showBrowserNotification,
  SERVICE_WORKER_READY_TIMEOUT_MS,
} from '../browser-notification';
import type { Notification as AppNotification } from '../types';
import { NotificationType, NotificationPriority } from '../types';

const sample: AppNotification = {
  id: 'n1',
  type: NotificationType.MESSAGE,
  title: 'Alice',
  content: 'hello',
  priority: NotificationPriority.NORMAL,
  read: false,
  timestamp: 0,
};

const constructed: ReturnType<typeof vi.fn> = vi.fn();

/** A platform where the constructor works (desktop). */
class WorkingNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<NotificationPermission> => 'granted');
  constructor(title: string, options?: NotificationOptions) {
    constructed(title, options);
  }
}

/** Chromium for Android: the constructor throws instead of no-opping. */
class AndroidNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<NotificationPermission> => {
    AndroidNotification.permission = 'granted';
    return 'granted';
  });
  constructor() {
    throw new TypeError(
      'Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.',
    );
  }
}

function stubServiceWorker(ready: Promise<unknown> | undefined): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: ready === undefined ? undefined : { ready },
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  constructed.mockReset();
  WorkingNotification.permission = 'granted';
  AndroidNotification.permission = 'default';
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('the first notification after granting permission (defect A)', () => {
  it('reaches the service worker on a platform whose constructor throws', async () => {
    const showNotification: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
    stubServiceWorker(Promise.resolve({ showNotification }));
    vi.stubGlobal('Notification', AndroidNotification);

    showBrowserNotification(sample);

    await vi.waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith('Alice', {
        body: 'hello',
        icon: '/favicon.ico',
        tag: 'n1',
      });
    });
    expect(AndroidNotification.requestPermission).toHaveBeenCalled();
  });

  it('still shows via the constructor where that is the surface (opposite direction)', async () => {
    // Without this, "always show nothing" would pass the test above's twin.
    WorkingNotification.permission = 'default';
    stubServiceWorker(undefined); // no service worker at all
    vi.stubGlobal('Notification', WorkingNotification);

    showBrowserNotification(sample);

    await vi.waitFor(() => {
      expect(constructed).toHaveBeenCalledTimes(1);
      expect(constructed).toHaveBeenCalledWith('Alice', {
        body: 'hello',
        icon: '/favicon.ico',
        tag: 'n1',
      });
    });
  });
});

describe('a service worker that never becomes ready (defect B)', () => {
  it('falls back to the constructor once the wait is bounded', async () => {
    vi.useFakeTimers();
    stubServiceWorker(new Promise(() => undefined)); // registered, never settles
    vi.stubGlobal('Notification', WorkingNotification);

    showBrowserNotification(sample);
    // Nothing before the bound: the SW is still being given its chance.
    await vi.advanceTimersByTimeAsync(SERVICE_WORKER_READY_TIMEOUT_MS - 1);
    expect(constructed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it('prefers the service worker when it IS ready (opposite direction)', async () => {
    const showNotification: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
    stubServiceWorker(Promise.resolve({ showNotification }));
    vi.stubGlobal('Notification', WorkingNotification);

    showBrowserNotification(sample);

    await vi.waitFor(() => {
      expect(showNotification).toHaveBeenCalledTimes(1);
    });
    // The bound must not race the working path into the constructor.
    expect(constructed).not.toHaveBeenCalled();
  });
});
