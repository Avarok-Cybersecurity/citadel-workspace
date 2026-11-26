/**
 * Reading the SDK's own group values out of a wire message.
 *
 * The types are generated (@avarok/citadel-protocol-types); these only check that a value off the
 * wire is one of them before anything acts on it, the way `toCid` checks a CID. A value that is
 * not is null, and the caller drops the message rather than guessing.
 */
import type {
  GroupDelivery, GroupEndReason, GroupMessageRefusal, GroupStateSource, NotDelivered, NotRelayed,
} from '@avarok/citadel-protocol-types';
import { toCid, variant } from './group-wire-variants';

const NOT_DELIVERED: readonly NotDelivered[] = ['Offline', 'BacklogFull', 'Unreachable'];
const NOT_RELAYED: readonly NotRelayed[] = ['SessionEnded', 'UnknownGroup', 'NoGroupKey', 'AlreadyRelayed', 'NotPositioned'];
const SOURCES: readonly GroupStateSource[] = ['ThisDevice', 'Backup', 'Rejoined', 'Refounded'];
const END_REASONS: readonly GroupEndReason[] = ['ClosedByOwner', 'Removed', 'HierarchyOwnerGone'];

function oneOf<T extends string>(raw: unknown, values: readonly T[]): T | null {
  return values.find((value: T): boolean => value === raw) ?? null;
}

function cids(raw: unknown): bigint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: bigint[] = [];
  for (const entry of raw) {
    const cid: bigint | null = toCid(entry);
    if (cid === null) return null;
    out.push(cid);
  }
  return out;
}

export function readDelivery(raw: unknown): GroupDelivery | null {
  if (!raw || typeof raw !== 'object') return null;
  const message: Record<string, unknown> = raw as Record<string, unknown>;
  const notRelayed: NotRelayed | null = oneOf(message.NotRelayed, NOT_RELAYED);
  if (notRelayed !== null) return { NotRelayed: notRelayed };
  const relayed: Record<string, unknown> | undefined = variant(message, 'Relayed');
  if (!relayed || !Array.isArray(relayed.not_delivered)) return null;
  const delivered: bigint[] | null = cids(relayed.delivered);
  const stored: bigint[] | null = cids(relayed.stored);
  if (delivered === null || stored === null) return null;
  const not_delivered: Array<[bigint, NotDelivered]> = [];
  for (const entry of relayed.not_delivered) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const cid: bigint | null = toCid(entry[0]);
    const why: NotDelivered | null = oneOf(entry[1], NOT_DELIVERED);
    if (cid === null || why === null) return null;
    not_delivered.push([cid, why]);
  }
  return { Relayed: { delivered, stored, not_delivered } };
}

export function readRefusal(raw: unknown): GroupMessageRefusal | null {
  if (raw === 'NotAMember') return 'NotAMember';
  if (!raw || typeof raw !== 'object') return null;
  const message: Record<string, unknown> = raw as Record<string, unknown>;
  const large: Record<string, unknown> | undefined = variant(message, 'TooLarge');
  const bytes: bigint | null = large ? toCid(large.bytes) : null;
  if (large && bytes !== null && typeof large.max_bytes === 'number') return { TooLarge: { bytes, max_bytes: large.max_bytes } };
  const rated: Record<string, unknown> | undefined = variant(message, 'RateLimited');
  if (rated && typeof rated.max_per_second === 'number') return { RateLimited: { max_per_second: rated.max_per_second } };
  return null;
}

export const readStateSource = (raw: unknown): GroupStateSource | null => oneOf(raw, SOURCES);
export const readEndReason = (raw: unknown): GroupEndReason | null => oneOf(raw, END_REASONS);
