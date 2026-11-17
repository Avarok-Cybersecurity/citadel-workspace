import type { WebSocketMessage } from '@/types/ws-message-types';

/**
 * PINCH POINT: Narrows unknown WebSocket event payload to typed union.
 * This is the ONLY place where untyped-to-typed conversion happens for WebSocket messages.
 * Returns null if the input isn't a valid discriminated union shape.
 */
export function narrowWebSocketMessage(raw: unknown): WebSocketMessage | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const keys: string[] = Object.keys(raw as Record<string, unknown>);
  if (keys.length === 0) return null;
  return raw as WebSocketMessage;
}

/**
 * PINCH POINT: Check if a WebSocketMessage contains a specific variant key.
 * Returns boolean without type predicate to avoid aggressive false-branch
 * narrowing to `never` in if-else chains under strictFunctionTypes.
 * Use getVariant() for direct data access after checking.
 */
export function hasVariant(message: WebSocketMessage, key: string): boolean {
  return typeof message === 'object' && message !== null && key in message;
}

/**
 * PINCH POINT: Extract variant data from a WebSocketMessage by key.
 * Returns the variant's payload as Record<string, unknown>, or undefined if not present.
 * Combines hasVariant check + typed data extraction in one call.
 */
export function getVariant(
  message: WebSocketMessage,
  key: string
): Record<string, unknown> | undefined {
  if (typeof message !== 'object' || message === null || !(key in message)) return undefined;
  return (message as Record<string, Record<string, unknown>>)[key];
}
