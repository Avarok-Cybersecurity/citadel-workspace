/**
 * The event the workspace response handler emits for every chat attachment answer this tab
 * receives (a chunk stored, a chunk read, a refusal), which lib/chat/attachments listens to. Not
 * raw and not logged: the bytes are a member's file.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { isVariant, type ChatAttachmentsResponse, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

export const CHAT_ATTACHMENTS_EVENT: 'workspace:chat-attachments' = 'workspace:chat-attachments';

/** Emits the answer when `response` is one; whether it was. */
export function emitChatAttachments(response: WorkspaceProtocolResponse): boolean {
  if (!isVariant(response, 'ChatAttachments')) return false;
  const answer: ChatAttachmentsResponse = response.ChatAttachments;
  eventEmitter.emit(CHAT_ATTACHMENTS_EVENT, answer);
  return true;
}
