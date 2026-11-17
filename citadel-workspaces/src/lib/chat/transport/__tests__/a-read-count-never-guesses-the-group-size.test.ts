/**
 * "Seen by X of Y" was computed from a member total that defaulted to 2 when a caller omitted it
 * (the office channel did), so a channel of forty said everyone had seen a message once one person
 * had. Receipts now come from the members' read cursors and the channel's roster; an unknown
 * roster gives no total and never "seen by everyone".
 */
import { describe, it, expect } from 'vitest';
import { readReceipts, receiptSummary, type ReceiptStamp, type RosterEntry } from '../read-receipts';

const roster: RosterEntry[] = [
  { username: 'ada', displayName: 'Ada Lovelace', online: true },
  { username: 'bob', displayName: 'Bob Byte', online: false },
  { username: 'cy', displayName: 'Cy Press', online: null },
  { username: 'dee', displayName: 'Dee Bug', online: true },
];
const messages: { id: string; own: boolean; }[] = [{ id: 'm1', own: true }, { id: 'm2', own: false }, { id: 'm3', own: true }];
const stamp = (cursors: [string, string][], list: RosterEntry[] | null, id: string): ReceiptStamp | undefined =>
  readReceipts({ messages, cursors: new Map(cursors), roster: list, selfUsername: 'ada' }).get(id);

describe('a node channel read receipt', () => {
  it('counts the members whose cursor is at the message or later, against the real roster', () => {
    const first: ReceiptStamp | undefined = stamp([['bob', 'm3'], ['cy', 'm1']], roster, 'm1');
    expect(first?.receipt).toEqual({ seenBy: ['Bob Byte', 'Cy Press'], of: 3 });
    expect(first?.status).toBe('sent');
    expect(receiptSummary(first!.receipt)).toBe('Seen by 2 of 3');
    expect(stamp([['bob', 'm3'], ['cy', 'm1']], roster, 'm3')?.receipt.seenBy).toEqual(['Bob Byte']);
  });

  it('is seen by everyone only when every other member of the roster has read it', () => {
    expect(stamp([['bob', 'm3'], ['cy', 'm3'], ['dee', 'm3']], roster, 'm3')?.status).toBe('read');
    // The reader's own cursor is not a reader.
    expect(stamp([['ada', 'm3'], ['bob', 'm3'], ['cy', 'm3']], roster, 'm3')?.status).toBe('sent');
  });

  it('names who has seen it, with no total and never everyone, when the roster is unknown', () => {
    const unknown: ReceiptStamp | undefined = stamp([['bob', 'm3'], ['cy', 'm3'], ['dee', 'm3']], null, 'm3');
    expect(unknown?.receipt).toEqual({ seenBy: ['bob', 'cy', 'dee'], of: null });
    expect(unknown?.status).toBe('sent');
    expect(receiptSummary(unknown!.receipt)).toBe('Seen by 3');
  });

  it('counts nobody for a cursor naming a message this tab does not hold', () => {
    expect(stamp([['bob', 'older-page'], ['cy', 'older-page'], ['dee', 'older-page']], roster, 'm1')?.receipt.seenBy).toEqual([]);
  });

  it('stamps only the reader own messages', () => {
    expect(stamp([['bob', 'm3']], roster, 'm2')).toBeUndefined();
  });
});
