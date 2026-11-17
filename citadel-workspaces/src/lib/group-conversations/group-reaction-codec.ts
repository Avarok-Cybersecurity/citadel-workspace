/**
 * A peer-group REACTION: one member adding or retracting an emoji on a message,
 * sent over the same `GroupMessage` transport as chat and control.
 *
 * Follows group-control-codec's rule for a non-chat body: NO `content` and NO
 * `control` field. Every build's `decodeGroupMessage` requires `content` to be a
 * string, and every build's `decodeGroupControl` requires `control`, so a client
 * that predates this envelope decodes it as neither and drops it ("did not
 * decode") instead of printing a CBOR map as a chat bubble.
 *
 * The envelope's `sender_cid` is the sender's claim and is NOT who reacted; the
 * inbound side takes the reactor from the protocol's `peer_cid`.
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';

export interface GroupReactionBody {
  /** The chat message reacted to; `message_id` below is this envelope's own id. */
  target_id: string;
  emoji: string;
  active: boolean;
  /** The reactor's clock; receivers keep the latest per (reactor, emoji). */
  at: number;
}

export interface PeerGroupReaction {
  group_id: string;
  message_id: string;
  sender_cid: bigint;
  timestamp: number;
  reaction: GroupReactionBody;
}

export function encodeGroupReaction(message: PeerGroupReaction): Uint8Array {
  return cborEncode(message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toBody(raw: unknown): GroupReactionBody | null {
  const r: Record<string, unknown> | null = asRecord(raw);
  if (!r || typeof r.target_id !== 'string' || typeof r.emoji !== 'string') return null;
  if (typeof r.active !== 'boolean' || typeof r.at !== 'number') return null;
  return { target_id: r.target_id, emoji: r.emoji, active: r.active, at: r.at };
}

/** Null for anything that is not a well-formed reaction envelope, including chat and control. */
export function decodeGroupReaction(bytes: Uint8Array): PeerGroupReaction | null {
  try {
    const decoded: Record<string, unknown> | null = asRecord(cborDecode(bytes));
    if (!decoded || decoded.reaction === undefined) return null;
    if (typeof decoded.group_id !== 'string' || typeof decoded.message_id !== 'string') return null;
    if (typeof decoded.sender_cid !== 'bigint') return null;
    const reaction: GroupReactionBody | null = toBody(decoded.reaction);
    if (!reaction) return null;
    return {
      group_id: decoded.group_id,
      message_id: decoded.message_id,
      sender_cid: decoded.sender_cid,
      timestamp: typeof decoded.timestamp === 'number' ? decoded.timestamp : Date.now(),
      reaction,
    };
  } catch {
    return null;
  }
}
