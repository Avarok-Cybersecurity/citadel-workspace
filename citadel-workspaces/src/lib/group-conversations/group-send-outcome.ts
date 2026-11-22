/**
 * What the server said became of one of the reader's own group messages, in words.
 *
 * Its delivery report names each other member as delivered now, held for them while they are
 * away, or not reached and why; a refusal says why it reached no one. Pure: the names come from
 * the caller's roster.
 */
import type { GroupDelivery, GroupMessageRefusal, NotDelivered, NotRelayed } from '@avarok/citadel-protocol-types';

/** The server's answer to one send: its delivery report, or its refusal. */
export type GroupSendOutcome = { readonly delivery: GroupDelivery } | { readonly refusal: GroupMessageRefusal };

export interface SendOutcomeNote {
  /** Everyone has it or has it held: shown as delivered, with no further line. */
  readonly complete: boolean;
  /** It reached no one. */
  readonly failed: boolean;
  readonly text: string;
}

const NOT_DELIVERED: Record<NotDelivered, string> = {
  Offline: 'offline',
  BacklogFull: 'backlog full',
  Unreachable: 'unreachable',
};

const NOT_RELAYED: Record<NotRelayed, string> = {
  SessionEnded: 'the session ended',
  UnknownGroup: 'this group no longer exists',
  NoGroupKey: "this device does not hold the group's keys yet",
};

/** Why a refused message reached no one. */
export function refusalText(refusal: GroupMessageRefusal): string {
  if (refusal === 'NotAMember') return 'You are no longer a member of this group';
  if ('TooLarge' in refusal) return `The message is too large for this group (at most ${refusal.TooLarge.max_bytes} bytes)`;
  return `This group allows at most ${refusal.RateLimited.max_per_second} messages a second`;
}

function deliveryNote(delivery: GroupDelivery, nameOf: (cid: bigint) => string): SendOutcomeNote {
  if ('NotRelayed' in delivery) return { complete: false, failed: true, text: `Not sent: ${NOT_RELAYED[delivery.NotRelayed]}` };
  const { delivered, stored, not_delivered } = delivery.Relayed;
  const parts: string[] = [];
  if (stored.length > 0) parts.push(`Delivered to ${delivered.length} · held for ${stored.length} offline`);
  for (const [cid, why] of not_delivered) parts.push(`Couldn't reach ${nameOf(cid)} (${NOT_DELIVERED[why]})`);
  const complete: boolean = parts.length === 0;
  return { complete, failed: false, text: complete ? 'Delivered' : parts.join(' · ') };
}

export function sendOutcomeNote(outcome: GroupSendOutcome, nameOf: (cid: bigint) => string): SendOutcomeNote {
  if ('refusal' in outcome) return { complete: false, failed: true, text: `Not sent: ${refusalText(outcome.refusal)}` };
  return deliveryNote(outcome.delivery, nameOf);
}
