/**
 * The bytes a peer-group message travels as.
 *
 * `InternalServiceRequest::GroupMessage` carries an opaque `Vec<u8>`; the
 * protocol does not care what is in it, so the two ends have to agree here.
 * CBOR, like every other P2P payload in this codebase — see
 * types/p2p-commands.ts — because it carries BigInt natively and JSON does not.
 *
 * Kept in one module so the encode and the decode cannot drift: a sender and a
 * receiver each with their own idea of the envelope is the failure this whole
 * campaign keeps finding, and here they would be two files apart.
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';

export interface PeerGroupMessage {
  group_id: string;
  /**
   * Minted by the sender, so a redelivery is recognisably the same message.
   * ILM redelivers -- round 465 measured one operation retransmitted 91 times
   * -- and `handleNewMessage` dedupes by id, so an id minted on arrival would
   * print the same text once per redelivery.
   */
  message_id: string;
  /** A CID is a bigint, and CBOR carries one natively — no string hop. */
  sender_cid: bigint;
  content: string;
  timestamp: number;
  /** The message this replies to, so threading survives the peer wire. */
  reply_to?: string;
  /**
   * The group's name, as its OWNER calls it.
   *
   * `GroupCreate` and `GroupInvite` have no name field, so this envelope is the
   * only thing members exchange that can carry one. The receiver honours it
   * only when the protocol says the owner sent it -- see peer-group-inbound.
   */
  group_name?: string;
}

export function encodeGroupMessage(message: PeerGroupMessage): Uint8Array {
  return cborEncode(message);
}

/**
 * Returns null for anything that does not decode to the agreed envelope.
 *
 * A peer running a different build, or a stray payload, must not throw inside
 * the inbound router — that would take down the handling of every message
 * behind it. Unreadable is not the same as absent, so the caller logs it.
 */
export function decodeGroupMessage(bytes: Uint8Array): PeerGroupMessage | null {
  try {
    const decoded: unknown = cborDecode(bytes);
    if (!decoded || typeof decoded !== 'object') return null;
    // A control envelope is never chat, even one that also carries text; see group-control-codec.
    if ('control' in decoded) return null;
    const candidate: Partial<PeerGroupMessage> = decoded as Partial<PeerGroupMessage>;
    if (typeof candidate.group_id !== 'string') return null;
    if (typeof candidate.message_id !== 'string') return null;
    if (typeof candidate.sender_cid !== 'bigint') return null;
    if (typeof candidate.content !== 'string') return null;
    return {
      group_id: candidate.group_id,
      message_id: candidate.message_id,
      reply_to: typeof candidate.reply_to === 'string' ? candidate.reply_to : undefined,
      group_name: typeof candidate.group_name === 'string' ? candidate.group_name : undefined,
      sender_cid: candidate.sender_cid,
      content: candidate.content,
      timestamp: typeof candidate.timestamp === 'number' ? candidate.timestamp : Date.now(),
    };
  } catch {
    return null;
  }
}
