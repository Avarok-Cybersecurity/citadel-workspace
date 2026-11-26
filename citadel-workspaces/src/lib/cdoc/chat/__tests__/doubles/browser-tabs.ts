/**
 * The browser's cross-window primitives, for tests in jsdom and Node 20, which have no Web Locks
 * API. The lock is a FIFO per name, as the Web Locks API's exclusive mode grants it; the channel
 * is the production chatTabs over it. One window alone gets a channel nobody else listens on.
 */
import type { ChatTabs } from '../../chat-ports';
import { chatTabs, type ExclusiveLocks } from '../../chat-tabs';

export function memoryExclusiveLocks(): ExclusiveLocks {
  const tails: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  return {
    run: <T>(name: string, step: () => Promise<T>): Promise<T> => {
      const next: Promise<T> = (tails.get(name) ?? Promise.resolve()).then(step);
      tails.set(name, next.then((): void => undefined, (): void => undefined));
      return next;
    },
  };
}

/**
 * Gives jsdom's navigator the Web Locks API's exclusive request (what webLocks() uses), backed by
 * memoryExclusiveLocks: for tests that render the app, whose chat documents take the real
 * production path. Defined once for the test file's page, as a browser has one.
 */
export function installMemoryWebLocks(): void {
  if (navigator.locks !== undefined) return;
  const locks: ExclusiveLocks = memoryExclusiveLocks();
  const request = <T>(name: string, step: () => Promise<T>): Promise<T> => locks.run(name, step);
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
}

/** A browser with one window: the production ChatTabs, with no other window on its channel. */
export function aloneInBrowser(): ChatTabs {
  return chatTabs(memoryExclusiveLocks(), { postMessage: (): void => undefined, addEventListener: (): void => undefined });
}
