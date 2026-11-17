/**
 * A node channel's reactions, read cursors and typing, as workspace requests.
 *
 * Reactions and cursors resolve when the server has taken them: it answers the sender with the
 * same notice it broadcasts, so the matcher tells this write's answer from another member's.
 * Typing is send-only. Its notice is relayed, never stored, and a typing refusal arriving as an
 * `Error` would be taken by whichever write is waiting (the protocol has no request id, see
 * await-write-response), so the sender's interval stays above the server's limit instead.
 */
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import type { ProtocolSender } from './workspace-operations';
import { awaitWriteResponse } from './await-write-response';

interface ChannelPayload { group_id?: string; message_id?: string; cursor?: { member?: string; upto_message_id?: string } }

export function reactGroupMessage(sender: ProtocolSender, groupId: string, messageId: string, emoji: string, on: boolean): Promise<void> {
  const request: WorkspaceProtocolRequestTS = { ReactGroupMessage: { group_id: groupId, message_id: messageId, emoji, on } };
  return awaitWriteResponse('ReactGroupMessage', () => sender.sendProtocolRequest(request), (payload: unknown): boolean => {
    const p: ChannelPayload | undefined = payload as ChannelPayload | undefined;
    return p?.group_id === groupId && p?.message_id === messageId;
  });
}

/** Resolves once the server has recorded `member`'s cursor at `uptoMessageId`. */
export function markGroupRead(sender: ProtocolSender, groupId: string, uptoMessageId: string, member: string): Promise<void> {
  const request: WorkspaceProtocolRequestTS = { MarkGroupRead: { group_id: groupId, upto_message_id: uptoMessageId } };
  return awaitWriteResponse('MarkGroupRead', () => sender.sendProtocolRequest(request), (payload: unknown): boolean => {
    const p: ChannelPayload | undefined = payload as ChannelPayload | undefined;
    return p?.group_id === groupId && p?.cursor?.member === member && p?.cursor?.upto_message_id === uptoMessageId;
  });
}

export function groupTyping(sender: ProtocolSender, groupId: string): Promise<void> {
  return sender.sendProtocolRequest({ GroupTyping: { group_id: groupId } });
}
