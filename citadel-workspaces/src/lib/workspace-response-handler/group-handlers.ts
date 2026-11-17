/**
 * Workspace Response Handler - Group Messaging Handlers
 *
 * Handles GroupMessageNotification, GroupMessages, GroupMessageEdited,
 * GroupMessageDeleted, and GroupMessage response variants.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { debugLog } from '@/lib/debug-config';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { isVariant , type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { ConnectionInfo } from './workspace-handlers';
import { handleGroupSignals } from './group-signal-handlers';
import { channelSignals } from '@/lib/group-conversations/channel-signals';

/**
 * Try to handle group-messaging response variants.
 *
 * Returns `true` if the response was handled.
 */
export function handleGroupVariants(
  response: WorkspaceProtocolResponse,
  connectionInfo: ConnectionInfo,
): boolean {
  if (isVariant(response, 'GroupMessageNotification')) {
    const { group_id, message } = response.GroupMessageNotification;
    debugLog('WorkspaceResponseHandler', 'GroupMessageNotification received', { group_id, message });
    groupMessagingManager.handleNewMessage(group_id, message);
    eventEmitter.emit('group:message:new', {
      groupId: group_id,
      message,
      connection: connectionInfo,
    });
    // The sidebar's unread badge, last-message preview and recency sort all
    // hang off 'group:message-received', which NOTHING emitted. Two half-built
    // pipes that never met: the badge never incremented for any message ever,
    // and the recency sort never reordered because lastMessageTime was never
    // set. Emitted here, beside its sibling, in the shape the store reads.
    eventEmitter.emit('group:message-received', {
      groupId: group_id,
      // So the store can apply it once. The transport redelivers, and without
      // an id every redelivery added another to the unread badge.
      messageId: message.id,
      senderId: message.sender_id,
      senderName: message.sender_name,
      content: message.content,
    });
    // Raw as well, so a sender awaiting confirmation can see it. This handler
    // returned true without it, so gating the send on this variant would have
    // made every successful send wait out the timeout — the exact regression
    // round twenty-six shipped.
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'GroupMessages')) {
    const { group_id, messages, has_more, read_cursors } = response.GroupMessages;
    debugLog('WorkspaceResponseHandler', 'GroupMessages received', { group_id, count: messages.length, has_more });
    // Cursors first: the page's arrival re-reads them, and they must already be this page's.
    channelSignals.replaceCursors(group_id, read_cursors);
    groupMessagingManager.handleMessagesLoaded(group_id, messages, has_more);
    eventEmitter.emit('group:messages:loaded', {
      groupId: group_id,
      messages,
      hasMore: has_more,
      connection: connectionInfo,
    });
    return true;
  }

  if (isVariant(response, 'GroupMessageEdited')) {
    const { group_id, message_id, new_content, edited_at } = response.GroupMessageEdited;
    debugLog('WorkspaceResponseHandler', 'GroupMessageEdited received', { group_id, message_id });
    groupMessagingManager.handleMessageEdited(group_id, message_id, new_content, edited_at);
    eventEmitter.emit('group:message:edited', {
      groupId: group_id,
      messageId: message_id,
      newContent: new_content,
      editedAt: edited_at,
      connection: connectionInfo,
    });
    // Also raw, so a caller awaiting confirmation can see it.
    //
    // `Success` and `Error` emit this; the handled variants did not — they
    // returned true and the response ended there. So every write gated on THIS
    // variant waited out its 15s timeout and told the user "the change may not
    // have been saved", after the same handler had already applied it. The
    // action worked, and the app said it had not.
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'GroupMessageDeleted')) {
    const { group_id, message_id, deleted_by } = response.GroupMessageDeleted;
    debugLog('WorkspaceResponseHandler', 'GroupMessageDeleted received', { group_id, message_id, deleted_by });
    groupMessagingManager.handleMessageDeleted(group_id, message_id);
    eventEmitter.emit('group:message:deleted', {
      groupId: group_id,
      messageId: message_id,
      deletedBy: deleted_by,
      connection: connectionInfo,
    });
    // Also raw, so a caller awaiting confirmation can see it.
    //
    // `Success` and `Error` emit this; the handled variants did not — they
    // returned true and the response ended there. So every write gated on THIS
    // variant waited out its 15s timeout and told the user "the change may not
    // have been saved", after the same handler had already applied it. The
    // action worked, and the app said it had not.
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'GroupMessage')) {
    debugLog('WorkspaceResponseHandler', 'GroupMessage received', response.GroupMessage);
    eventEmitter.emit('group:message:single', {
      message: response.GroupMessage,
      connection: connectionInfo,
    });
    return true;
  }

  return handleGroupSignals(response);
}
