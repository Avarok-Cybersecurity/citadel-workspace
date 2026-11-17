/**
 * A node channel's reactions, read cursors and typing, as they arrive from the workspace server.
 *
 * A reaction notice carries the message's whole reaction list after the change, so it replaces
 * the held list rather than folding one entry in. Reactions and cursor moves also go out raw:
 * the server answers their sender with the same notice, and that is what settles the sender's
 * write (await-write-response). Typing is a relay and settles nothing.
 */
import { isVariant, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { channelSignals } from '@/lib/group-conversations/channel-signals';

/** Returns true when the response was one of these. */
export function handleGroupSignals(response: WorkspaceProtocolResponse): boolean {
  if (isVariant(response, 'GroupMessageReacted')) {
    const { group_id, message_id, reactions } = response.GroupMessageReacted;
    groupMessagingManager.handleReactionsReplaced(group_id, message_id, reactions);
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }
  if (isVariant(response, 'GroupReadCursorMoved')) {
    const { group_id, cursor } = response.GroupReadCursorMoved;
    channelSignals.moveCursor(group_id, cursor);
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }
  if (isVariant(response, 'GroupTypingNotice')) {
    const { group_id, member } = response.GroupTypingNotice;
    channelSignals.typing(group_id, member);
    return true;
  }
  return false;
}
