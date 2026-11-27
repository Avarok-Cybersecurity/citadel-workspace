/**
 * A peer-group CONTROL message arriving from the internal service.
 *
 * The sibling of peer-group-inbound, and the same two rules: the GROUP KEY
 * decides which group this is, and the protocol's `peer_cid` decides who sent
 * it -- the sender the SDK verified the message's signature against. The
 * envelope's own `group_id` and `sender_cid` are the sender's claims, and
 * permission is judged on who the protocol says spoke, never on who the body
 * says it is. Who owns the group is the receiver's own record (group-owner).
 */
import { decodeGroupControl, type GroupControlBody, type PeerGroupControl } from './group-control-codec';
import { groupKeyToId, parseGroupKey, type MessageGroupKey } from './group-key';
import { toCid } from './group-wire-variants';
import { isByteArray } from '@/lib/utils/encoding-utils';

export interface GroupControlEvent {
  groupId: string;
  /** Who the protocol says sent it: the signer the SDK verified. */
  sender_cid: bigint;
  control: GroupControlBody;
  /** The assigned members' usernames, resolved by group-response-service. */
  memberUsernames?: Record<string, string>;
}

/** The `group:control-received` payload, or null when this is not a control message. */
export function peerGroupControlEvent(notification: Record<string, unknown>): GroupControlEvent | null {
  const raw: unknown = notification.message;
  if (!isByteArray(raw)) return null;
  const decoded: PeerGroupControl | null = decodeGroupControl(raw);
  if (!decoded) return null;
  const sender_cid: bigint | null = toCid(notification.peer_cid);
  if (sender_cid === null) return null;
  // Throws on a malformed key, like every other arm; group-response-service catches and logs.
  const key: MessageGroupKey = parseGroupKey(notification.group_key);
  return { groupId: groupKeyToId(key), sender_cid, control: decoded.control };
}
