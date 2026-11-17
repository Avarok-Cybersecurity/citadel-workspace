import { notifyEach } from '@/lib/notify-listeners';

/**
 * One value held outside React, readable with `useSyncExternalStore`.
 *
 * For state that something outside the component tree decides — a service
 * worker, a poll, a wire notification — and a component shows. `set` notifies
 * only on a change, so a snapshot read in render stays stable between writes.
 */
export interface ValueStore<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createValueStore<T>(context: string, initial: T): ValueStore<T> {
  let value: T = initial;
  const listeners: Set<() => void> = new Set<() => void>();
  return {
    get: (): T => value,
    set: (next: T): void => {
      if (Object.is(next, value)) return;
      value = next;
      notifyEach(listeners, context);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
  };
}
