/**
 * A peer-group CONTROL message arriving from the internal service.
 *
 * The sibling of peer-group-inbound, and the same two rules: the GROUP KEY
 * decides which group this is, and the protocol's `peer_cid` decides who sent
 * it. The envelope's own `group_id` and `sender_cid` are the sender's claims,
 * and permission is judged on who the protocol says spoke, never on who the
 * body says it is.
 */
import { decodeGroupControl, type GroupControlBody, type PeerGroupControl } from './group-control-codec';
import { groupKeyToId, parseGroupKey, type MessageGroupKey } from './group-key';
import { toCid } from './group-wire-variants';

export interface GroupControlEvent {
  groupId: string;
  /** Who the protocol says sent it. */
  senderCid: bigint;
  /** Who the group key names as owner; always permitted. */
  ownerCid: bigint;
  control: GroupControlBody;
  /** The assigned members' usernames, resolved by group-response-service. */
  memberUsernames?: Record<string, string>;
}

/** The `group:control-received` payload, or null when this is not a control message. */
export function peerGroupControlEvent(notification: Record<string, unknown>): GroupControlEvent | null {
  const raw: unknown = notification.message;
  if (!Array.isArray(raw)) return null;
  const decoded: PeerGroupControl | null = decodeGroupControl(new Uint8Array(raw as number[]));
  if (!decoded) return null;
  const senderCid: bigint | null = toCid(notification.peer_cid);
  if (senderCid === null) return null;
  // Throws on a malformed key, like every other arm; group-response-service catches and logs.
  const key: MessageGroupKey = parseGroupKey(notification.group_key);
  return { groupId: groupKeyToId(key), senderCid, ownerCid: key.cid, control: decoded.control };
}
