/**
 * A record's client id is only its sender's claim: it cannot replace or crowd out another
 * session's caret, one session holds a bounded number of carets, and a repaint re-derives only
 * the carets it can have moved. Plain values: PeerBook is pure.
 */
import { describe, expect, it } from 'vitest';
import type { PeerView } from '../../editor/controller';
import type { PeerPresence } from '../../editor/peer-overlay';
import { PeerBook } from '../peer-book';
import type { PeerIdentity } from '../ports';

const MALLORY: bigint = 7n;
const BOB: bigint = 8n;
const named: PeerIdentity = (cid: bigint) => ({ name: cid === BOB ? 'Bob' : 'Mallory', color: '#10B981' });

const at = (client: bigint, page: number | null): PeerView => ({
  client,
  caret: page === null ? null : { page, rect: { x: 0, y: 0, width: 0, height: 10 } },
  selectionRects: [],
});
const record = (n: number): Uint8Array => new Uint8Array([n]);
const drawn = (book: PeerBook): { name: string; client: bigint }[] =>
  book.presences().map((p: PeerPresence) => ({ name: p.name, client: p.view.client }));

describe('PeerBook', () => {
  it('keeps a sender\'s caret when another session claims its client id', () => {
    const book: PeerBook = new PeerBook(named, 10_000, 4);
    book.hear(BOB, record(1), at(42n, 0), 0);
    book.hear(MALLORY, record(2), at(42n, 3), 1);
    expect(drawn(book)).toEqual([{ name: 'Bob', client: 42n }, { name: 'Mallory', client: 42n }]);
    expect(book.presences()[0].view.caret?.page).toBe(0);
  });

  it('holds at most the configured carets per session, dropping the one heard least recently', () => {
    const book: PeerBook = new PeerBook(named, 10_000, 3);
    book.hear(BOB, record(0), at(1n, 0), 0);
    for (let client: bigint = 100n; client < 150n; client += 1n) book.hear(MALLORY, record(1), at(client, 0), 1);
    book.hear(MALLORY, record(1), at(147n, 0), 2);
    expect(drawn(book)).toEqual([
      { name: 'Bob', client: 1n },
      { name: 'Mallory', client: 148n },
      { name: 'Mallory', client: 149n },
      { name: 'Mallory', client: 147n },
    ]);
  });

  it('re-derives only the carets at or after the first repainted page, and every unplaced one', async () => {
    const book: PeerBook = new PeerBook(named, 10_000, 4);
    book.hear(BOB, record(1), at(1n, 0), 0);
    book.hear(BOB, record(2), at(2n, 2), 0);
    book.hear(BOB, record(3), at(3n, null), 0);
    const asked: number[] = [];
    await book.remap(async (r: Uint8Array): Promise<PeerView> => { asked.push(r[0]); return at(BigInt(r[0]), 5); }, 1);
    expect(asked).toEqual([2, 3]);
    await book.remap(async (r: Uint8Array): Promise<PeerView> => { asked.push(r[0]); return at(BigInt(r[0]), 5); }, null);
    expect(asked).toEqual([2, 3, 1, 2, 3]);
  });

  it('refuses a cap below one caret', () => {
    expect(() => new PeerBook(named, 10_000, 0)).toThrow('at least one caret');
  });
});
