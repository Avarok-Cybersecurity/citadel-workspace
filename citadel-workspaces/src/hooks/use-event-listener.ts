/**
 * useEventListener Hook
 *
 * Simplifies event listener subscription with automatic cleanup.
 * Works with the global eventEmitter singleton.
 *
 * @example
 * // Single event
 * useEventListener('user:profile-updated', (data) => {
 *   debugLog('UseEventListener', 'Profile updated:', data);
 * });
 *
 * @example
 * // Multiple events with same handler
 * useEventListener(['event1', 'event2'], (data) => {
 *   debugLog('UseEventListener', 'Received:', data);
 * });
 */

import { useEffect, useRef } from 'react';
import { eventEmitter, type EventHandler } from '@/lib/event-emitter';

/**
 * Subscribe to a single event with automatic cleanup.
 * @param eventName - The event name to subscribe to
 * @param handler - The event handler function
 * @param deps - Optional dependency array (defaults to [handler])
 */
export function useEventListener<T = unknown>(
  eventName: string,
  handler: EventHandler<T>,
  deps: React.DependencyList = []
): void {
  // Store handler in ref to avoid re-subscribing on every render
  const handlerRef: React.MutableRefObject<EventHandler<T>> = useRef<EventHandler<T>>(handler);

  // Update ref when handler changes
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    // Create stable wrapper that calls current handler
    const stableHandler: EventHandler<T> = (payload) => {
      handlerRef.current(payload);
    };

    const unsubscribe: () => void = eventEmitter.on(eventName, stableHandler);

    return (): void => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps]);
}

/**
 * Subscribe to multiple events with the same handler.
 * @param eventNames - Array of event names to subscribe to
 * @param handler - The event handler function
 * @param deps - Optional dependency array
 */
export function useEventListeners<T = unknown>(
  eventNames: string[],
  handler: EventHandler<T>,
  deps: React.DependencyList = []
): void {
  const handlerRef: React.MutableRefObject<EventHandler<T>> = useRef<EventHandler<T>>(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const stableHandler: EventHandler<T> = (payload) => {
      handlerRef.current(payload);
    };

    const unsubscribes: (() => void)[] = eventNames.map(name =>
      eventEmitter.on(name, stableHandler)
    );

    return (): void => {
      unsubscribes.forEach(unsub => unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(eventNames), ...deps]);
}

/**
 * Subscribe to an event and collect payloads into an array.
 * Useful for accumulating events over time.
 * @param eventName - The event name to subscribe to
 * @param maxItems - Maximum items to keep (defaults to 100)
 */
export function useEventCollector<T = unknown>(
  eventName: string,
  maxItems: number = 100
): T[] {
  const itemsRef: React.MutableRefObject<T[]> = useRef<T[]>([]);

  useEventListener<T>(eventName, (payload) => {
    itemsRef.current = [...itemsRef.current.slice(-(maxItems - 1)), payload];
  }, [maxItems]);

  return itemsRef.current;
}
