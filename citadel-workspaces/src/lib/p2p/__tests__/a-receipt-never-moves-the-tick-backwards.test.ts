/**
 * A redelivered `delivered` receipt turned a read message back into a delivered
 * one.
 *
 * Receipts arrive more than once by design: the sender resends whenever it
 * misses an ACK, and re-ACKing a duplicate is what makes retransmission work
 * (see the ILM inbound path, which re-ACKs deliberately). So a `delivered`
 * receipt routinely lands after the recipient has already read the message.
 *
 * `handleMessageAck` assigned `message.status = newStatus` outright — while the
 * helper directly beneath it, `propagateStatusToEarlierMessages`, carried the
 * rule in a comment: "Only upgrade status (sent -> delivered -> read), never
 * downgrade". One idea, stated in one of the two places that needed it.
 */
import { describe, it, expect } from 'vitest';
import { statusAdvances } from '../message-status';
import type { P2PMessage } from '../p2p-types';

type Status = P2PMessage['status'];

describe('a delivery receipt', () => {
  it('advances along sent → delivered → read', () => {
    expect(statusAdvances('sent', 'delivered')).toBe(true);
    expect(statusAdvances('sent', 'read')).toBe(true);
    expect(statusAdvances('delivered', 'read')).toBe(true);
  });

  it('never moves the tick backwards', () => {
    // The defect, exactly: a resend's receipt arriving after the read receipt.
    expect(statusAdvances('read', 'delivered')).toBe(false);
    expect(statusAdvances('read', 'sent')).toBe(false);
    expect(statusAdvances('delivered', 'sent')).toBe(false);
  });

  it('treats a repeat of what we already believe as no news', () => {
    for (const status of ['sent', 'delivered', 'read', 'failed'] as Status[]) {
      expect(statusAdvances(status, status), `${status} repeated`).toBe(false);
    }
  });

  it('reports a failure we have no positive evidence against', () => {
    expect(statusAdvances('sent', 'failed')).toBe(true);
  });

  it('refuses a stale failure about a message that demonstrably arrived', () => {
    // `failed` claims the send did not happen. Delivery and read receipts are
    // proof it did, so a late failure is stale rather than a correction.
    expect(statusAdvances('delivered', 'failed')).toBe(false);
    expect(statusAdvances('read', 'failed')).toBe(false);
  });

  it('lets positive evidence overturn a recorded failure', () => {
    // The other direction is a real correction: it arrived after all.
    expect(statusAdvances('failed', 'delivered')).toBe(true);
    expect(statusAdvances('failed', 'read')).toBe(true);
  });
});
