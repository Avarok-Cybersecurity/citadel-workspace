/**
 * The conversation requests an agent that hosts this account answers.
 *
 * The agent is the only writer of the account's conversations (agent 0.8.6,
 * kernel/conversations). A window asks it for every change and every read; it
 * never parses the agent's LocalDB records itself. The payload types are the
 * agent's own, generated from its Rust definitions.
 */
import type {
  AccountPreferences,
  Attachment,
  ConversationMessage,
  ConversationMetadata,
  ConversationPage,
  MessagePatch,
  MessageType,
} from 'citadel-internal-service-wasm-client';
import { requestResponse } from '../websocket/request-response';
import { TIMEOUT } from '../timeout-constants';

import { conversationSender, type RequestSender } from './sender';

export { registerConversationSender, sendToAgent, type RequestSender } from './sender';

function unwrap(message: Record<string, unknown>): Record<string, unknown> {
  return ((message.Response as Record<string, unknown> | undefined) ?? message);
}

function answer(message: Record<string, unknown>, variant: string, requestId: string): Record<string, unknown> | undefined {
  const value: unknown = unwrap(message)[variant];
  if (typeof value !== 'object' || value === null) return undefined;
  const v: Record<string, unknown> = value as Record<string, unknown>;
  return v.request_id === requestId ? v : undefined;
}

/** Send `body` as request variant `variant`; resolve with what `success` reads from the answer. */
async function ask<T>(
  variant: string,
  body: Record<string, unknown>,
  success: string,
  read: (answer: Record<string, unknown>) => T,
  requestId: string = crypto.randomUUID(),
): Promise<T> {
  const send: RequestSender | null = conversationSender();
  if (!send) throw new Error(`${variant}: the websocket service is not ready`);
  return requestResponse<T>({
    request: { [variant]: { request_id: requestId, ...body } },
    requestId,
    sendRequest: (request, id) => send(request as Record<string, unknown>, id),
    timeoutMs: TIMEOUT.LOCALDB_REQUEST_MS,
    operationName: variant,
    matcher: {
      matchSuccess: (message) => {
        const found: Record<string, unknown> | undefined = answer(message, success, requestId);
        return found ? read(found) : undefined;
      },
      matchFailure: (message) => {
        const failed: Record<string, unknown> | undefined =
          answer(message, 'ConversationFailure', requestId) ?? answer(message, 'MessageSendFailure', requestId);
        return failed ? String(failed.message ?? `${variant} failed`) : undefined;
      },
    },
  });
}

const touched = (a: Record<string, unknown>): ConversationMessage | null =>
  (a.message as ConversationMessage | null | undefined) ?? null;
/** For a request whose answer carries nothing to read: matched is enough. */
const matched = (): true => true;
const done = (): void => undefined;

export interface Outgoing {
  content: string;
  message_type: MessageType;
  reply_to: string | null;
  mentions: string[] | null;
  attachments: Attachment[] | null;
  document_id: string | null;
  document_title: string | null;
  /** The chat's security level (chat-advanced-settings), as the agent's `SecurityLevel` names it. */
  security_level: string;
}

export const agentConversations: {
  /** `requestId` comes back on the send's Appended event, before this answers. */
  send(cid: bigint, peer: bigint, out: Outgoing, requestId: string): Promise<ConversationMessage | null>;
  resend(cid: bigint, peer: bigint, messageId: string): Promise<ConversationMessage | null>;
  edit(cid: bigint, peer: bigint, messageId: string, contents: string): Promise<ConversationMessage | null>;
  remove(cid: bigint, peer: bigint, messageId: string): Promise<ConversationMessage | null>;
  react(cid: bigint, peer: bigint, messageId: string, emoji: string, active: boolean): Promise<ConversationMessage | null>;
  markRead(cid: bigint, peer: bigint): Promise<void>;
  record(cid: bigint, peer: bigint, message: ConversationMessage): Promise<void>;
  patch(cid: bigint, peer: bigint, messageId: string, patch: MessagePatch): Promise<ConversationMessage | null>;
  clear(cid: bigint, peer: bigint, includeUnattributed: boolean): Promise<void>;
  list(cid: bigint): Promise<ConversationMetadata[]>;
  page(cid: bigint, peer: bigint, page: number | null): Promise<{ metadata: ConversationMetadata | null; page: ConversationPage | null }>;
  setPreferences(cid: bigint, preferences: AccountPreferences): Promise<void>;
  /** What the agent holds for the account: its UI defaults if nothing was ever pushed. */
  getPreferences(cid: bigint): Promise<AccountPreferences>;
  sendReliable(cid: bigint, peer: bigint, message: Uint8Array, securityLevel: string, compressionHint: string | null): Promise<void>;
} = {
  send: (cid, peer, out, requestId) =>
    ask('ConversationSend', { cid, peer_cid: peer, ...out }, 'ConversationUpdated', touched, requestId),
  resend: (cid, peer, messageId) =>
    ask('ConversationResend', { cid, peer_cid: peer, message_id: messageId }, 'ConversationUpdated', touched),
  edit: (cid, peer, messageId, contents) =>
    ask('ConversationEdit', { cid, peer_cid: peer, message_id: messageId, contents }, 'ConversationUpdated', touched),
  remove: (cid, peer, messageId) =>
    ask('ConversationDelete', { cid, peer_cid: peer, message_id: messageId }, 'ConversationUpdated', touched),
  react: (cid, peer, messageId, emoji, active) =>
    ask('ConversationReact', { cid, peer_cid: peer, message_id: messageId, emoji, active }, 'ConversationUpdated', touched),
  markRead: (cid, peer) =>
    ask('ConversationMarkRead', { cid, peer_cid: peer }, 'ConversationUpdated', matched).then(done),
  record: (cid, peer, message) =>
    ask('ConversationRecord', { cid, peer_cid: peer, message }, 'ConversationUpdated', matched).then(done),
  patch: (cid, peer, messageId, patch) =>
    ask('ConversationPatch', { cid, peer_cid: peer, message_id: messageId, patch }, 'ConversationUpdated', touched),
  clear: (cid, peer, includeUnattributed) =>
    ask('ConversationClear', { cid, peer_cid: peer, include_unattributed: includeUnattributed }, 'ConversationUpdated', matched).then(done),
  list: (cid) =>
    ask('ConversationList', { cid }, 'ConversationListResponse', (a) => (a.conversations as ConversationMetadata[] | undefined) ?? []),
  page: (cid, peer, page) =>
    ask('ConversationPage', { cid, peer_cid: peer, page }, 'ConversationPageResponse', (a) => ({
      metadata: (a.metadata as ConversationMetadata | null | undefined) ?? null,
      page: (a.page as ConversationPage | null | undefined) ?? null,
    })),
  setPreferences: (cid, preferences) =>
    ask('SetAccountPreferences', { cid, preferences }, 'AccountPreferencesResponse', matched).then(done),
  getPreferences: (cid) =>
    ask('GetAccountPreferences', { cid }, 'AccountPreferencesResponse', (a) => a.preferences as AccountPreferences),
  sendReliable: (cid, peer, message, securityLevel, compressionHint) =>
    ask(
      'SendReliable',
      { cid, peer_cid: peer, message: Array.from(message), security_level: securityLevel, compression_hint: compressionHint },
      'SendReliableAccepted',
      matched,
    ).then(done),
};
