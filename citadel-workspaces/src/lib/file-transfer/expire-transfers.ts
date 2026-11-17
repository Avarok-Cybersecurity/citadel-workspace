/**
 * Letting a file offer go stale, which nothing did.
 *
 * `expiresAt` is stamped on every outgoing offer and shipped to the peer, the
 * `'expired'` state exists in the union, and the bubble has a "Request expired"
 * branch — and nothing ever wrote that state. `FILE_TRANSFER_EXPIRY_CHECK_
 * INTERVAL_MS` had zero usages.
 *
 * So a sender who goes offline mid-offer leaves the recipient a live-looking
 * Accept button for ever. Pressing it starts a transfer nobody is on the other
 * end of, which then sits at "Downloading…" until the tab is closed. Three
 * pieces of a feature, built, shipped and never joined.
 *
 * Kept as a pure function so the decision is testable without a clock, a
 * service or a peer.
 */

import type { FileTransfer } from './types';

/** Transfers still waiting on somebody, which are the only ones that can expire. */
const AWAITING: ReadonlySet<string> = new Set(['queued', 'pending']);

/**
 * The ids of transfers whose offer has lapsed.
 *
 * An offer with no `expiresAt` never lapses: it predates the field, or came
 * from a peer that does not send one, and inventing a deadline for it would
 * cancel a transfer the sender still believes is open.
 */
export function expiredTransferIds(transfers: readonly FileTransfer[], now: number): string[] {
  return transfers
    .filter((t) => AWAITING.has(t.state) && t.expiresAt !== undefined && t.expiresAt <= now)
    .map((t) => t.id);
}
