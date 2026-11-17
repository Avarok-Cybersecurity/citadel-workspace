/**
 * A peer-group message arriving from the internal service.
 *
 * The workspace protocol has a `GroupMessageNotification` too, and it is a
 * different shape: `{ group_id, message }` there, where `message` is already a
 * `GroupMessage`. This one is `{ cid, peer_cid, message: number[], group_key,
 * request_id }` — an opaque body the two peers agree on, see
 * group-message-codec.
 *
 * A translator, like everything else in group-events: it turns a wire message
 * into the event the store already reads, rather than reaching for the store
 * itself. Two rules matter and both are tested:
 *
 *  - an unreadable body is dropped, not thrown. A peer on a different build
 *    would otherwise take down the handling of everything queued behind it.
 *  - the GROUP KEY decides which conversation this belongs to, never the body.
 *    The envelope is written by the sender; the key is the protocol's. A body
 *    naming another group would otherwise file the message into a conversation
 *    it was never sent to.
 *  - `peer_cid` decides who sent it, never the envelope's `sender_cid`. The SDK
 *    relays the author's cid unchanged through the server, so `peer_cid` is the
 *    author, not a relay; `sender_cid` is whatever the sending client wrote.
 */
import { decodeGroupMessage, type PeerGroupMessage } from './group-message-codec';
import { groupKeyToId, type MessageGroupKey } from './group-key';
import { toCid } from './group-wire-variants';
import { debugLog } from '@/lib/debug-config';
import { decodeGroupFileShare, fileInfoOf, type PeerGroupFileShare } from './group-file-codec';
import { sharedFileText } from './group-file-preview';
import type { GroupFileShare } from '@/types/group-file-share';

export interface PeerGroupMessageSummary {
  groupId: string;
  /** The sender's id for this message; survives redelivery. */
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  replyTo?: string;
  /** The group's name, present only when its owner sent this. */
  groupName?: string;
  /** Present when this message announces a shared file; `content` then previews it. */
  fileShare?: GroupFileShare;
}

/**
 * The name to adopt from this message, if its sender may give the group one.
 *
 * The group key names the owner and `peer_cid` is the protocol's word for who
 * sent the message; the envelope's `sender_cid` is the sender's own claim, so
 * it is not what decides. A member cannot rename the group for everyone.
 */
function ownerGivenName(
  notification: Record<string, unknown>,
  key: MessageGroupKey,
  decoded: PeerGroupMessage,
): string | undefined {
  const name: string | undefined = decoded.group_name?.trim();
  if (!name) return undefined;
  const sender: bigint | null = toCid(notification.peer_cid);
  return sender !== null && sender === toCid(key.cid) ? name : undefined;
}

/** The `group:message-received` payload for this notification, or null. */
export function peerGroupMessageEvent(
  notification: Record<string, unknown>,
  peerName: (cid: bigint) => string,
): PeerGroupMessageSummary | null {
  const raw: unknown = notification.message;
  if (!Array.isArray(raw)) return null;

  const bytes: Uint8Array = new Uint8Array(raw as number[]);
  const file: PeerGroupFileShare | null = decodeGroupFileShare(bytes);
  if (file) return fileShareEvent(notification, file, peerName);
  const decoded: PeerGroupMessage | null = decodeGroupMessage(bytes);
  if (!decoded) {
    debugLog('PeerGroupInbound', 'Dropped a group message body that did not decode');
    return null;
  }

  const sender: bigint | null = toCid(notification.peer_cid);
  if (sender === null) return null;

  // String only here, at the event boundary: `group:message-received` has
  // always carried senderId as a string and group-store compares it against
  // String(own). The wire and this module keep the bigint.
  const key: MessageGroupKey = notification.group_key as MessageGroupKey;
  return {
    groupId: groupKeyToId(key),
    messageId: decoded.message_id,
    senderId: sender.toString(),
    senderName: peerName(sender),
    content: decoded.content,
    timestamp: decoded.timestamp,
    replyTo: decoded.reply_to,
    groupName: ownerGivenName(notification, key, decoded),
  };
}

/**
 * A file announcement, filed like chat so the sidebar, unread badge, thread and
 * transcript all treat it as a message. The group key decides the group, as
 * above; the offer to accept arrives separately, over the sender's P2P channel.
 */
function fileShareEvent(
  notification: Record<string, unknown>,
  envelope: PeerGroupFileShare,
  peerName: (cid: bigint) => string,
): PeerGroupMessageSummary | null {
  const sender: bigint | null = toCid(notification.peer_cid);
  if (sender === null) return null;
  const key: MessageGroupKey = notification.group_key as MessageGroupKey;
  const fileShare: GroupFileShare = { ...fileInfoOf(envelope), senderCid: sender };
  return {
    groupId: groupKeyToId(key),
    messageId: envelope.message_id,
    senderId: sender.toString(),
    senderName: peerName(sender),
    content: sharedFileText(fileShare),
    timestamp: envelope.timestamp,
    fileShare,
  };
}
