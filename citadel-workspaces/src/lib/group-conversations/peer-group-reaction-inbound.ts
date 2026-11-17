/**
 * A peer-group REACTION arriving from the internal service.
 *
 * The sibling of peer-group-control-inbound, with the same two rules: the GROUP
 * KEY decides which group this is, and the protocol's `peer_cid` decides who
 * reacted. The envelope's `group_id` and `sender_cid` are the sender's claims;
 * trusting them would let one member add or remove another member's reaction.
 */
import { decodeGroupReaction, type PeerGroupReaction } from './group-reaction-codec';
import { groupKeyToId, parseGroupKey, type MessageGroupKey } from './group-key';
import { toCid } from './group-wire-variants';
import type { ReactionChange } from '@/lib/reactions/reaction-state';

export interface GroupReactionEvent {
  groupId: string;
  /** The message reacted to. */
  messageId: string;
  /** Its reactor is the cid the protocol says sent it. */
  change: ReactionChange;
}

/** The `group:reaction-received` payload, or null when this is not a reaction. */
export function peerGroupReactionEvent(notification: Record<string, unknown>): GroupReactionEvent | null {
  const raw: unknown = notification.message;
  if (!Array.isArray(raw)) return null;
  const decoded: PeerGroupReaction | null = decodeGroupReaction(new Uint8Array(raw as number[]));
  if (!decoded) return null;
  const reactorCid: bigint | null = toCid(notification.peer_cid);
  if (reactorCid === null) return null;
  // Throws on a malformed key, like every other arm; group-response-service catches and logs.
  const key: MessageGroupKey = parseGroupKey(notification.group_key);
  const { target_id, emoji, active, at } = decoded.reaction;
  return { groupId: groupKeyToId(key), messageId: target_id, change: { emoji, reactorCid, at, active } };
}
