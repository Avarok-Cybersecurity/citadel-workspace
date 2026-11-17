/**
 * A file offer that lapses must stop looking live.
 *
 * `expiresAt` was stamped on every offer and shipped to the peer, the
 * `'expired'` state existed in the union, and the bubble had a "Request
 * expired" branch — and nothing ever wrote that state. So a sender who went
 * offline mid-offer left the recipient a live-looking Accept button for ever,
 * and pressing it started a transfer nobody was on the other end of.
 *
 * Three pieces of one feature, each shipped, never joined.
 */

import { describe, it, expect } from 'vitest';
import { expiredTransferIds } from '../expire-transfers';
import type { FileTransfer } from '../types';

const offer = (over: Record<string, unknown> = {}): FileTransfer =>
  ({
    id: 't-1',
    state: 'pending',
    expiresAt: 1_000,
    ...over,
  }) as unknown as FileTransfer;

describe('offer expiry', () => {
  it('lapses an offer whose deadline has passed', () => {
    expect(expiredTransferIds([offer()], 2_000)).toEqual(['t-1']);
  });

  it('leaves an offer that is still open', () => {
    expect(expiredTransferIds([offer()], 500)).toEqual([]);
  });

  it('lapses exactly at the deadline, not a tick later', () => {
    expect(expiredTransferIds([offer()], 1_000)).toEqual(['t-1']);
  });

  it('never lapses an offer with no deadline', () => {
    // It predates the field, or came from a peer that sends none. Inventing a
    // deadline would cancel a transfer the sender still believes is open.
    expect(expiredTransferIds([offer({ expiresAt: undefined })], 9_999_999)).toEqual([]);
  });

  it('only touches offers that are still waiting on somebody', () => {
    // A completed transfer with an old deadline must not be rewritten to
    // "expired" — that would turn a delivered file into a failure in the
    // history.
    for (const state of ['complete', 'transferring', 'declined', 'cancelled', 'error']) {
      expect(expiredTransferIds([offer({ state })], 9_999_999), state).toEqual([]);
    }
  });

  it('lapses a held send too, not only a pending offer', () => {
    expect(expiredTransferIds([offer({ state: 'queued' })], 2_000)).toEqual(['t-1']);
  });
});
