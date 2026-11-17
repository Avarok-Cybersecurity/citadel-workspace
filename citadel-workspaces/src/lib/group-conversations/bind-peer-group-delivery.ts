/**
 * Route a peer-group message into the open conversation.
 *
 * `group:message-received` drives the sidebar and is emitted for BOTH kinds of
 * group. The workspace path already hands its messages to the thread itself, in
 * `workspace-response-handler/group-handlers.ts`; binding this for every group
 * would print every workspace message twice.
 *
 * So the binding asks which kind of group it is, using the same discriminator
 * the send side uses — the id itself, via `groupSendTransport`. One question,
 * one answer, both directions.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { groupSendTransport } from './group-send-transport';
import { deliverPeerGroupMessage } from './peer-group-delivery';
import type { GroupFileShare } from '@/types/group-file-share';

export function bindPeerGroupDelivery(): () => void {
  const onReceived = (data: {
    groupId: string;
    messageId?: string;
    senderId: string;
    senderName?: string;
    content: string;
    timestamp?: number;
    replyTo?: string;
    fileShare?: GroupFileShare;
  }): void => {
    if (groupSendTransport(data.groupId) !== 'peer') return;
    // No id means this did not come through the peer envelope, and delivering
    // it without one would let `handleNewMessage` treat two arrivals of the
    // same message as two messages.
    if (!data.messageId) return;

    deliverPeerGroupMessage({
      groupId: data.groupId,
      messageId: data.messageId,
      senderId: data.senderId,
      senderName: data.senderName ?? data.senderId,
      content: data.content,
      timestamp: data.timestamp ?? Date.now(),
      replyTo: data.replyTo,
      fileShare: data.fileShare,
    });
  };

  eventEmitter.on('group:message-received', onReceived);
  return (): void => { eventEmitter.off('group:message-received', onReceived); };
}
