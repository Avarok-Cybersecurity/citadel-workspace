/**
 * Sending one message into whichever kind of group this is.
 *
 * Two groups sit behind one chat view and they differ in three ways that all
 * have to be handled together, which is why this is one function rather than a
 * branch in the hook:
 *
 *  - WHERE it goes. A node-backed chat channel belongs to the workspace server;
 *    a peer group is keyed `<cid>:<mgid>`, owned by no node, and that server
 *    refuses it -- "Permission denied: not a member of this chat channel".
 *  - WHETHER it comes back. The workspace server answers the SENDER with the
 *    same notification it broadcasts to everyone, and that echo is what puts
 *    the message on your own screen. The peer wire answers with
 *    `GroupMessageSuccess`, which carries no content, so the sender has to
 *    place its own copy or watch the composer clear and nothing appear.
 *  - WHICH id it has. The local copy uses the id the send minted, so an echo --
 *    if one ever arrives -- is deduped by `handleNewMessage` rather than
 *    printed twice.
 */
import WorkspaceService from '@/lib/workspace-service';
import { GroupMessageTypeTS } from '@/types/workspace-protocol';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { groupSendTransport } from './group-send-transport';
import { sendPeerGroupMessage } from './group-requests';
import { eventEmitter } from '@/lib/event-emitter';
import { deliverPeerGroupMessage } from './peer-group-delivery';
import { ownerAnnouncedName } from './group-names';
import { getGroups } from './group-store';

export async function sendGroupMessageAnywhere(
  groupId: string,
  content: string,
  replyTo?: string,
): Promise<void> {
  if (groupSendTransport(groupId) !== 'peer') {
    await WorkspaceService.sendGroupMessage(groupId, content, GroupMessageTypeTS.Text, replyTo);
    return;
  }

  const self: bigint | null = instanceManager.cid;
  const groupName: string | undefined = self === null
    ? undefined
    : ownerAnnouncedName(getGroups().find((group) => group.id === groupId), self);
  const messageId: string = await sendPeerGroupMessage(groupId, content, replyTo, groupName);

  const delivery: Parameters<typeof deliverPeerGroupMessage>[0] = {
    groupId,
    messageId,
    senderId: String(instanceManager.cid ?? ''),
    senderName: 'You',
    content,
    timestamp: Date.now(),
    replyTo,
  };

  // BOTH halves, because they are different halves.
  //
  // The direct call puts the message in the open thread and does not depend on
  // anything being installed first — routing the thread through the event
  // instead made your own message's appearance conditional on the group store
  // having initialised, which an existing test caught immediately.
  deliverPeerGroupMessage(delivery);

  // And the event, which is what the SIDEBAR listens to: preview, unread badge,
  // recency sort. Without it a message you sent appeared in the conversation
  // while the sidebar went on showing the previous one, and the group never rose
  // to the top of the list.
  //
  // Not a double delivery: `bind-peer-group-delivery` also calls
  // `deliverPeerGroupMessage`, and `handleNewMessage` refuses an id already in
  // the conversation — which is exactly why the binding insists on an id.
  eventEmitter.emit('group:message-received', {
    groupId,
    messageId,
    senderId: String(instanceManager.cid ?? ''),
    senderName: 'You',
    content,
    timestamp: Date.now(),
    replyTo,
  });
}
