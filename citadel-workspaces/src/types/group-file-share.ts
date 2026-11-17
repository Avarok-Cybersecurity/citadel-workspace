/**
 * A file shared into a peer group.
 *
 * The agent has no group file primitive -- `SendFile` names one `peer_cid` and
 * `GroupMessage` carries only an opaque body -- so a group share is ONE group
 * message announcing the file plus one ordinary P2P transfer per member. These
 * are the shapes both halves share.
 */

/** What every member is told about the file. */
export interface GroupFileInfo {
  name: string;
  size: number;
  mimeType: string;
}

/**
 * What happened when the SENDER tried to reach one member.
 *
 * `offered` names the transfer the existing service owns; its live state
 * (accepted, declined, failed) is read from that record, never copied here, so
 * there is one answer to "did they take it". The other two are final at send
 * time because no transfer exists to ask.
 */
export type MemberDelivery =
  | { kind: 'offered'; cid: bigint; username: string; transferId: string }
  /** Never attempted: not P2P-registered with the sender. */
  | { kind: 'skipped'; cid: bigint; username: string; reason: string }
  /** Attempted, and the send itself was refused. */
  | { kind: 'failed'; cid: bigint; username: string; reason: string };

export interface GroupFileShare extends GroupFileInfo {
  senderCid: bigint;
  /** Present only on the sender's own copy: the per-member ledger. */
  deliveries?: MemberDelivery[];
}
