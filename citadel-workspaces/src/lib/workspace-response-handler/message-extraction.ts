/**
 * Workspace Response Handler - Message Extraction
 *
 * Extracts and parses WorkspaceProtocolResponse payloads from
 * MessageNotification, MessageDelivered, and direct Response messages.
 */

import { debugLog, debugEnabled, errorLog } from '@/lib/debug-config';
import { narrowWebSocketMessage } from '@/lib/ws-message-boundary';
import type { WebSocketMessage } from '@/types/ws-message-types';
import { decodeWorkspacePayload, isVariant, type WorkspaceProtocolPayload, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { formatForDebug } from '@/lib/debug-formatter';

// The envelope logs below go through formatForDebug, which prints a payload's
// ends rather than its bytes and redacts secret-named fields: the payload is an
// encoded response, and an IceServers response carries a TURN `credential`.

/**
 * Attempt to extract a WorkspaceProtocolResponse from a raw WebSocket event.
 *
 * Returns `null` when the message is not workspace-relevant (e.g. P2P-only).
 */
export function extractWorkspaceResponse(raw: unknown): WorkspaceProtocolResponse | null {
  const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
  if (!message) return null;
  return extractFromMessage(message);
}

/**
 * Internal extraction from a narrowed WebSocketMessage.
 */
function extractFromMessage(message: WebSocketMessage): WorkspaceProtocolResponse | null {
  // Cast to record for multi-variant optional chaining
  const msg: Record<string, Record<string, unknown> | undefined> = message as Record<string, Record<string, unknown> | undefined>;

  // --- MessageNotification ---
  if (msg.MessageNotification) {
    return extractFromNotification(msg.MessageNotification);
  }

  // --- MessageDelivered ---
  if (msg.MessageDelivered) {
    return extractFromDelivered(msg.MessageDelivered);
  }

  // --- Direct Response ---
  if (msg.Response) {
    if (debugEnabled) debugLog('WorkspaceResponseHandler', 'Processing direct response', formatForDebug(msg.Response));
    return msg.Response as unknown as WorkspaceProtocolResponse;
  }

  return null;
}

/**
 * Extract from a MessageNotification payload.
 * Returns null for P2P messages (non-zero peer_cid different from cid).
 */
function extractFromNotification(
  notification: Record<string, unknown>,
): WorkspaceProtocolResponse | null {
  if (debugEnabled) debugLog('WorkspaceResponseHandler', 'Received MessageNotification', formatForDebug(notification));

  // P2P guard: peer_cid !== 0 && peer_cid !== cid => let p2p-messenger-manager handle it
  if (notification.peer_cid && notification.cid) {
    const peerCidStr: string = String(notification.peer_cid);
    const cidStr: string = String(notification.cid);

    if (peerCidStr !== '0' && peerCidStr !== cidStr) {
      debugLog('WorkspaceResponseHandler', 'P2P message from peer, skipping workspace parsing', {
        peer_cid: peerCidStr,
        cid: cidStr,
      });
      return null;
    }
  }

  return decodeByteArrayPayload(notification.message, 'MessageNotification');
}

/**
 * Extract from a MessageDelivered payload.
 */
function extractFromDelivered(
  delivered: Record<string, unknown>,
): WorkspaceProtocolResponse | null {
  if (debugEnabled) debugLog('WorkspaceResponseHandler', 'Received MessageDelivered', formatForDebug(delivered));
  return decodeByteArrayPayload(delivered.contents, 'MessageDelivered');
}

/**
 * Decode a byte-array field into a WorkspaceProtocolResponse.
 *
 * The field is expected to be a `number[]` that decodes to a JSON string
 * containing `{ Response: <WorkspaceProtocolResponse> }`.
 */
function decodeByteArrayPayload(
  field: unknown,
  sourceLabel: string,
): WorkspaceProtocolResponse | null {
  if (!field || !Array.isArray(field)) {
    debugLog('WorkspaceResponseHandler', `${sourceLabel} missing payload field`);
    return null;
  }

  try {
    // The u64-exact codec, not JSON.parse: a bare parse turned every u64 into a lossy number where
    // the types promise bigint, and the admin Telemetry section crashed dividing one by a bigint.
    const workspacePayload: WorkspaceProtocolPayload = decodeWorkspacePayload(new Uint8Array(field as number[]));

    if (isVariant(workspacePayload, 'Response')) {
      return workspacePayload.Response;
    }

    debugLog('WorkspaceResponseHandler', 'No Response field in payload', workspacePayload);
    return null;
  } catch (decodeError) {
    errorLog(`Failed to decode ${sourceLabel} contents`, decodeError);
    return null;
  }
}
