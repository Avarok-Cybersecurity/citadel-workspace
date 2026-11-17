/**
 * Message Routing
 *
 * Core routing logic: extracting request IDs, target CIDs, and routing
 * decisions for incoming WebSocket messages.
 */

import { debugLog } from '@/lib/debug-config';
import {
  CID_FIELDS,
  CID_ROUTED_NOTIFICATIONS,
  arrivesAtFrameRate,
  getMessageType,
} from './routing-rules';

/**
 * Extract request_id from a response message for routing.
 *
 * IMPORTANT: Some notification messages (like PeerRegisterNotification) have a
 * request_id that belongs to the SENDER, not the RECIPIENT. For these messages,
 * we must NOT use request_id routing - instead, the router will fall through to
 * CID-based routing which uses the 'cid' field to find the correct recipient.
 */
export function extractRequestId(message: Record<string, unknown>): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const messageType: ReturnType<typeof getMessageType> = getMessageType(message);

  // Skip request_id extraction for notification messages that should be routed by CID
  if (CID_ROUTED_NOTIFICATIONS.has(messageType)) {
    if (!arrivesAtFrameRate(messageType)) debugLog('InstanceInboundRouter', `[ILM-Router] ${messageType} uses CID routing, skipping request_id extraction`);
    return null;
  }

  const payload: Record<string, unknown> | undefined = message[messageType] as Record<string, unknown> | undefined;

  if (payload && typeof payload === 'object') {
    if (payload.request_id) {
      return String(payload.request_id);
    }
  }

  return null;
}

/**
 * Extract the target CID from a message.
 * Messages can have CID in various places depending on type.
 */
export function extractTargetCid(message: Record<string, unknown>): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  // Check top level
  for (const field of CID_FIELDS) {
    if (message[field]) {
      return String(message[field]);
    }
  }

  // Check nested in message type (e.g., { MessageNotification: { cid: ... } })
  const messageType: ReturnType<typeof getMessageType> = getMessageType(message);
  const payload: Record<string, unknown> | undefined = message[messageType] as Record<string, unknown> | undefined;

  if (payload && typeof payload === 'object') {
    for (const field of CID_FIELDS) {
      if (payload[field]) {
        return String(payload[field]);
      }
    }

    // Check for Response wrapper
    const response: Record<string, unknown> | undefined = payload.Response as Record<string, unknown> | undefined;
    if (response) {
      for (const field of CID_FIELDS) {
        if (response[field]) {
          return String(response[field]);
        }
      }
    }
  }

  return null;
}
