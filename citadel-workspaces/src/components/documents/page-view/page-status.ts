/**
 * "Page N of M", held outside React state: the page under the viewport changes on almost every
 * frame of a fast scroll, and as DocsCanvas state each change re-rendered the ribbon and the
 * page view with it. Only the status bar subscribes, so only it re-renders.
 */
import { useSyncExternalStore } from 'react';
import type { PageStatus } from './PageColumn';

export interface PageStatusStore {
  readonly set: (next: PageStatus) => void;
  readonly get: () => PageStatus | null;
  readonly subscribe: (listener: () => void) => () => void;
}

export function pageStatusStore(): PageStatusStore {
  let current: PageStatus | null = null;
  const listeners: Set<() => void> = new Set<() => void>();
  return {
    set: (next: PageStatus): void => {
      if (current !== null && current.current === next.current && current.total === next.total) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    get: (): PageStatus | null => current,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

export function usePageStatus(store: PageStatusStore): PageStatus | null {
  return useSyncExternalStore(store.subscribe, store.get);
}
