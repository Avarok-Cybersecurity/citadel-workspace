/**
 * What the sender's group bubble says about each member, and in total.
 *
 * Pure: the ledger (who was offered, skipped or refused) plus a lookup into the
 * transfer service's records. An offered member's state is the RECORD's --
 * accepted, declined, failed are all learnt by that service after the bubble
 * exists -- so it is read on every render and never copied into the message.
 */
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { MemberDelivery } from '@/types/group-file-share';
import { peerFailureDetail } from '@/lib/p2p/peer-failure-detail';

export type MemberDeliveryStatus = 'sent' | 'accepted' | 'received' | 'declined' | 'failed' | 'not-delivered';

export interface MemberDeliveryRow {
  cid: bigint;
  username: string;
  status: MemberDeliveryStatus;
  /** Why, for every status that is not good news. */
  reason?: string;
}

export interface DeliverySummary {
  total: number;
  counts: Record<MemberDeliveryStatus, number>;
  rows: MemberDeliveryRow[];
  text: string;
}

export const MISSING_RECORD_REASON: string = 'no record of this transfer on this device';

function offeredRow(delivery: Extract<MemberDelivery, { kind: 'offered' }>, record: FileTransfer | undefined): MemberDeliveryRow {
  const base: { cid: bigint; username: string } = { cid: delivery.cid, username: delivery.username };
  if (!record) return { ...base, status: 'failed', reason: MISSING_RECORD_REASON };
  switch (record.state) {
    case 'queued': case 'preparing': case 'pending':
      return { ...base, status: 'sent' };
    case 'transferring':
      return { ...base, status: 'accepted' };
    case 'complete':
      return { ...base, status: 'received' };
    case 'declined':
      return { ...base, status: 'declined', reason: record.errorMessage };
    case 'cancelled':
      return { ...base, status: 'failed', reason: record.errorMessage ?? 'cancelled' };
    case 'expired':
      return { ...base, status: 'failed', reason: record.errorMessage ?? 'the offer expired unanswered' };
    case 'error':
      return { ...base, status: 'failed', reason: record.errorMessage ?? 'the transfer failed' };
  }
}

function rawRow(delivery: MemberDelivery, lookup: (transferId: string) => FileTransfer | undefined): MemberDeliveryRow {
  if (delivery.kind === 'offered') return offeredRow(delivery, lookup(delivery.transferId));
  const status: MemberDeliveryStatus = delivery.kind === 'skipped' ? 'not-delivered' : 'failed';
  return { cid: delivery.cid, username: delivery.username, status, reason: delivery.reason };
}

/**
 * A failure's reason is the transport's own words until translated -- measured
 * live as "failed — No messaging handle found for l…", a CID and a WASM
 * function name. Translated here, on read, so a ledger stored before this
 * existed reads the same way. A decline's reason is the member's own text and
 * a skip's is ours, so neither is touched.
 */
export function memberDeliveryRow(delivery: MemberDelivery, lookup: (transferId: string) => FileTransfer | undefined): MemberDeliveryRow {
  const row: MemberDeliveryRow = rawRow(delivery, lookup);
  if (row.status !== 'failed' || row.reason === undefined) return row;
  return { ...row, reason: peerFailureDetail(row.reason).detail };
}

const ORDER: ReadonlyArray<[MemberDeliveryStatus, string]> = [
  ['received', 'received'], ['accepted', 'accepted'], ['sent', 'awaiting an answer'],
  ['declined', 'declined'], ['failed', 'failed'], ['not-delivered', 'not delivered'],
];

export function summariseDeliveries(
  deliveries: readonly MemberDelivery[],
  lookup: (transferId: string) => FileTransfer | undefined,
): DeliverySummary {
  const rows: MemberDeliveryRow[] = deliveries.map((d: MemberDelivery): MemberDeliveryRow => memberDeliveryRow(d, lookup));
  const counts: Record<MemberDeliveryStatus, number> = {
    sent: 0, accepted: 0, received: 0, declined: 0, failed: 0, 'not-delivered': 0,
  };
  for (const row of rows) counts[row.status] += 1;
  const total: number = rows.length;
  const parts: string[] = ORDER
    .filter(([status]: [MemberDeliveryStatus, string]): boolean => counts[status] > 0)
    .map(([status, label]: [MemberDeliveryStatus, string]): string => `${counts[status]} ${label}`);
  const text: string = total === 0
    ? 'No other members to send to'
    : `Sent to ${total} ${total === 1 ? 'member' : 'members'}: ${parts.join(', ')}`;
  return { total, counts, rows, text };
}
