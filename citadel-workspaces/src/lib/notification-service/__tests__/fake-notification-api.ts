/**
 * A stand-in for the browser's Notification API, with the contract the page relies on: a
 * permission the browser holds, a prompt that answers it (counted, so a test can say whether the
 * page asked), and a notification that reports `show` or `error`. A justified stand-in: CI cannot
 * drive a real permission prompt or the system's notification centre.
 */
import { vi } from 'vitest';

export interface FakeNotificationApi {
  /** What the next prompt answers. */
  answer: NotificationPermission;
  /** How a constructed notification ends: shown, refused, or the constructor throws (Android). */
  outcome: 'show' | 'error' | 'throw';
  readonly asked: () => number;
  readonly shown: string[];
  /** The body of each shown notification, in order. */
  readonly bodies: string[];
  /** The tag of each shown notification, in order: one tag is one notification to the system. */
  readonly tags: string[];
  readonly setPermission: (p: NotificationPermission) => void;
}

export function installFakeNotificationApi(permission: NotificationPermission): FakeNotificationApi {
  let asks: number = 0;
  const api: FakeNotificationApi = {
    answer: 'granted', outcome: 'show', shown: [], bodies: [], tags: [],
    asked: (): number => asks,
    setPermission: (p: NotificationPermission): void => { Fake.permission = p; },
  };
  class Fake {
    static permission: NotificationPermission = permission;
    static requestPermission = async (): Promise<NotificationPermission> => {
      asks += 1;
      Fake.permission = api.answer;
      return api.answer;
    };
    onshow: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      if (api.outcome === 'throw') throw new TypeError('Illegal constructor');
      api.shown.push(title);
      api.bodies.push(options?.body ?? '');
      api.tags.push(options?.tag ?? '');
      setTimeout((): void => { (api.outcome === 'show' ? this.onshow : this.onerror)?.(); }, 0);
    }
  }
  vi.stubGlobal('Notification', Fake);
  return api;
}
