/**
 * A group message (a node channel's or a peer group's) as the chat pane shows it.
 *
 * The pane renders one message shape, the direct chat's, so a channel's messages get the same
 * bubbles, markdown, ticks and reply quotes. Pure: who the reader is arrives as a value, and the
 * two wires' ways of naming a sender are settled by `isOwnGroupMessage` and `senderUsernameOf`,
 * which every other group surface (the bell, the unread count, the avatars) already uses.
 */
import type { GroupMessage } from '@/types/workspace-entities';
import type { MessageStatus } from 'citadel-internal-service-wasm-client';
import type { MessageType } from '@/types/message-protocol';
import { isOwnGroupMessage } from '@/lib/group-conversations/own-message';
import { senderUsernameOf } from '@/components/chat/shared/sender-username';
import type { ChatAuthor, ChatMessage, ChatSelf } from './chat-transport';
import { sharedFile } from '@/lib/chat/attachments/shared-file';

type WireKind = GroupMessage['message_type'];

const KINDS: Readonly<Record<Extract<WireKind, string>, MessageType>> = {
  Text: 'text',
  Markdown: 'markdown',
  System: 'system_notice',
};

/**
 * The pane's type, and for a shared document the fields its bubble opens it by (the title is the
 * content); for a shared file, the file its card reads from the server.
 */
function kindOf(kind: WireKind, content: string): Pick<ChatMessage, 'message_type' | 'document_id' | 'document_title' | 'attachment'> {
  if (typeof kind === 'string') return { message_type: KINDS[kind] };
  if ('LiveDocument' in kind) return { message_type: 'live_document', document_id: kind.LiveDocument.document_id, document_title: content };
  return { message_type: 'text', attachment: sharedFile(kind.FileShare) };
}

export function groupAuthor(message: Pick<GroupMessage, 'sender_id' | 'sender_name'>, self: ChatSelf | null): ChatAuthor {
  const own: boolean = self !== null && isOwnGroupMessage(message.sender_id, { cid: self.cid, username: self.username });
  if (own && self !== null) return { own: true, name: self.displayName, username: null };
  return { own: false, name: message.sender_name, username: senderUsernameOf(message) };
}

/**
 * `status` is what the transport can say about a stored message: the server holds it, so the
 * sender's copy is at least sent; read state arrives with read cursors, never guessed here.
 */
export function groupChatMessage(message: GroupMessage, self: ChatSelf | null, status: MessageStatus): ChatMessage {
  return {
    id: message.id,
    content: message.content,
    timestamp: Number(message.timestamp),
    index: 0,
    status,
    ...kindOf(message.message_type, message.content),
    ...(message.reply_to !== null ? { replyTo: message.reply_to } : {}),
    ...(message.edited_at !== null ? { edited_at: Number(message.edited_at) } : {}),
    ...(message.reactions !== undefined ? { reactions: message.reactions } : {}),
    author: groupAuthor(message, self),
    share: message.file_share ?? null,
  };
}

/** What `groupChatMessage` is given for the status of every stored message. */
export const STORED: MessageStatus = 'sent';
