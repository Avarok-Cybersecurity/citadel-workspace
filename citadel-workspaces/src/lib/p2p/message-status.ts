/**
 * Which message status supersedes which.
 *
 * A delivery receipt is a claim about the past, and receipts arrive more than
 * once: the sender resends whenever it misses an ACK, and re-ACKing a duplicate
 * is deliberate — it is what makes retransmission work. So a `delivered` ack can
 * and does arrive after the recipient has already read the message.
 *
 * `propagateStatusToEarlierMessages` has always known this: "Only upgrade status
 * (sent -> delivered -> read), never downgrade". The direct assignment it sits
 * beside did not, so a redelivered receipt turned a read message back into a
 * delivered one and the sender watched the tick go backwards. Same file, same
 * idea, stated in one of the two places that needed it.
 */
import type { P2PMessage } from './p2p-types';

type Status = P2PMessage['status'];

/** How far along the delivery story each status is. `failed` is not on it. */
const RANK: Record<string, number> = { sent: 0, delivered: 1, read: 2 };

/**
 * Whether `next` is news, given what we already believe.
 *
 * `failed` is not a rung on the ladder — it is a claim that the send did not
 * happen — so it applies to anything we have no positive evidence about, and is
 * refused once we do. A message that was delivered or read demonstrably arrived,
 * and a late failure report about it is stale, not a correction.
 */
export function statusAdvances(current: Status, next: Status): boolean {
  if (next === current) return false;
  if (next === 'failed') return current !== 'delivered' && current !== 'read';
  // Positive evidence always beats a recorded failure: it did arrive after all.
  if (current === 'failed') return true;
  return (RANK[next] ?? -1) > (RANK[current] ?? -1);
}
