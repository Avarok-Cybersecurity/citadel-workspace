/**
 * Handing a peer-group message to the conversation you are looking at.
 *
 * `group:message-received` drives the SIDEBAR — unread badge, preview, recency
 * sort. The open conversation reads none of it: `useGroupChat` subscribes to
 * `groupMessagingManager.subscribeToGroup`, and the workspace path feeds that
 * by calling `handleNewMessage` directly. Round 470 wired the sidebar half and
 * would have shipped a peer-group message that updated the badge and never
 * appeared in the thread.
 *
 * Only peer groups come through here. The workspace path already calls
 * `handleNewMessage` in `workspace-response-handler/group-handlers.ts`, and
 * calling it again from a shared event binding would print every workspace
 * message twice.
 */
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { GroupMessageTypeTS } from '@/types/workspace-protocol';
import type { GroupMessage } from '@/types/workspace-entities';
import type { GroupFileShare } from '@/types/group-file-share';

export interface PeerGroupDelivery {
  groupId: string;
  /**
   * Minted by the SENDER and carried on the wire.
   *
   * `handleNewMessage` dedupes by id, and ILM redelivers — round 465 measured
   * one operation retransmitted 91 times. An id minted on arrival would make
   * every redelivery a new message and print the same text repeatedly.
   */
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  replyTo?: string;
  /** A shared file; see group-file-codec. */
  fileShare?: GroupFileShare;
}

export function deliverPeerGroupMessage(delivery: PeerGroupDelivery): void {
  const message: GroupMessage = {
    id: delivery.messageId,
    group_id: delivery.groupId,
    sender_id: delivery.senderId,
    sender_name: delivery.senderName,
    message_type: GroupMessageTypeTS.Text as unknown as GroupMessage['message_type'],
    content: delivery.content,
    timestamp: BigInt(delivery.timestamp),
    reply_to: delivery.replyTo ?? null,
    reply_count: 0,
    mentions: [],
    edited_at: null,
    ...(delivery.fileShare ? { file_share: delivery.fileShare } : {}),
  };
  groupMessagingManager.handleNewMessage(delivery.groupId, message);
}
