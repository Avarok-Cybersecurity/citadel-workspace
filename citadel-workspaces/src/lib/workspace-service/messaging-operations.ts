/**
 * Workspace Service - Messaging Operations
 *
 * Methods for sending messages and group messaging (send, edit, delete,
 * get messages, get threads) plus user profile updates.
 */

import type {
  WorkspaceProtocolRequestTS,
  SentGroupMessageType,
} from '@/types/workspace-protocol';
import { GroupMessageTypeTS as GroupMessageTypeEnum } from '@/types/workspace-protocol';
import type { ProtocolSender } from './workspace-operations';
import { awaitWriteResponse } from './await-write-response';

/**
 * Send a message via workspace protocol
 */
export async function sendMessage(sender: ProtocolSender, contents: Uint8Array): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    Message: { contents: new Uint8Array(contents) }
  } as WorkspaceProtocolRequestTS;
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Send a group message to a chat channel
 */
export async function sendGroupMessage(
  sender: ProtocolSender,
  groupId: string,
  content: string,
  messageType: SentGroupMessageType = GroupMessageTypeEnum.Text,
  replyTo?: string,
  mentions?: string[]
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    SendGroupMessage: {
      group_id: groupId,
      message_type: messageType,
      content,
      reply_to: replyTo,
      mentions
    }
  };
  // The composer clears on resolve, so a send that resolved on DISPATCH threw
  // the user's text away whenever the server refused — a store failure, or the
  // rate limiter's "Please slow down" — with the message never appearing and no
  // error shown, because the refusal arrives as a generic Error nothing handles.
  return awaitWriteResponse(
    'SendGroupMessage',
    () => sender.sendProtocolRequest(requestPart),
    (payload) => {
      const p: { group_id?: string; message?: { content?: string; }; } | undefined = payload as { group_id?: string; message?: { content?: string } } | undefined;
      return p?.group_id === groupId && p?.message?.content === content;
    }
  );
}

/**
 * Edit an existing group message
 */
export async function editGroupMessage(
  sender: ProtocolSender,
  groupId: string,
  messageId: string,
  newContent: string
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    EditGroupMessage: {
      group_id: groupId,
      message_id: messageId,
      new_content: newContent
    }
  };
  // Resolves when the SERVER accepts it. A refusal arrives as a response,
  // which cannot reject a send-only promise — so this used to report success
  // for writes the server was about to refuse.
  return awaitWriteResponse('EditGroupMessage', () => sender.sendProtocolRequest(requestPart));
}

/**
 * Delete a group message
 */
export async function deleteGroupMessage(
  sender: ProtocolSender,
  groupId: string,
  messageId: string
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    DeleteGroupMessage: {
      group_id: groupId,
      message_id: messageId
    }
  };
  // Resolves when the SERVER accepts it. A refusal arrives as a response,
  // which cannot reject a send-only promise — so this used to report success
  // for writes the server was about to refuse.
  return awaitWriteResponse('DeleteGroupMessage', () => sender.sendProtocolRequest(requestPart));
}

/**
 * Get paginated group messages
 */
export async function getGroupMessages(
  sender: ProtocolSender,
  groupId: string,
  beforeTimestamp?: number | bigint,
  limit: number = 50
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    GetGroupMessages: {
      group_id: groupId,
      before_timestamp: beforeTimestamp != null ? Number(beforeTimestamp) : undefined,
      limit
    }
  };
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Get thread messages (replies to a parent message)
 */
export async function getThreadMessages(
  sender: ProtocolSender,
  groupId: string,
  parentMessageId: string
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    GetThreadMessages: {
      group_id: groupId,
      parent_message_id: parentMessageId
    }
  };
  return sender.sendProtocolRequest(requestPart);
}

/**
 * What a profile update may change. An absent field is left as it is; an empty
 * `email` or `title` clears it.
 */
export interface ProfileUpdate {
  name?: string;
  avatarData?: string;
  email?: string;
  title?: string;
  /** Server-enforced; see lib/profile-privacy.ts. */
  showProfileToStrangers?: boolean;
  /** Published copy of the local setting, for refused requesters. */
  acceptsRequestsFromStrangers?: boolean;
  /** Published copy of the local Online Status setting, for other members' clients. */
  showsOnlineStatus?: boolean;
}

/**
 * Update the current user's profile
 */
export async function updateUserProfile(
  sender: ProtocolSender,
  update: ProfileUpdate,
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    UpdateUserProfile: {
      name: update.name,
      avatar_data: update.avatarData,
      email: update.email,
      title: update.title,
      show_profile_to_strangers: update.showProfileToStrangers,
      accepts_requests_from_strangers: update.acceptsRequestsFromStrangers,
      shows_online_status: update.showsOnlineStatus,
    }
  };
  // The settings form disables every input on `isSaving` and cleared it only on
  // the success event, so a refusal locked the whole panel in "Saving…" until
  // it was closed and reopened. Gating makes the refusal a rejection the caller
  // can actually see.
  return awaitWriteResponse('UpdateUserProfile', () => sender.sendProtocolRequest(requestPart));
}
