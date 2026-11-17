/**
 * The expiry sweep marked a transfer expired in memory and left it `'pending'`
 * on disk.
 *
 * The sweep exists because `expiresAt` was stamped and shipped, `'expired'`
 * existed in the state union, the bubble had a "Request expired" branch — and
 * nothing ever wrote that state, so a sender who went offline mid-offer left the
 * recipient a live-looking Accept button for ever.
 *
 * It wrote the in-memory store and emitted the change, and stopped there. The
 * persisted record stayed `'pending'`, so the next reload restored exactly the
 * button the sweep had just removed. The bug came back every time the tab did —
 * and a `'pending'` record is also exempt from history pruning, so it stays
 * for ever rather than aging out with the terminal ones.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startExpirySweep } from '../expiry-sweep';
import type { FileTransfer } from '../types';

function transfer(overrides: Partial<FileTransfer> = {}): FileTransfer {
  return {
    id: 't-1', fileName: 'notes.md', fileSize: 1, fileType: 'text/plain',
    mode: 'p2p', state: 'pending', progress: 0,
    senderCid: '7', recipientCid: '9',
    createdAt: 0, updatedAt: 0,
    expiresAt: 1_000,
    isIncoming: true,
    ...overrides,
  } as FileTransfer;
}

interface Harness {
  saved: FileTransfer[];
  emitted: FileTransfer[];
  store: Record<string, FileTransfer>;
}

function run(initial: FileTransfer[]): Harness {
  const store: Record<string, FileTransfer> = {};
  for (const t of initial) store[t.id] = t;
  const saved: FileTransfer[] = [];
  const emitted: FileTransfer[] = [];

  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  vi.stubGlobal('window', { setInterval: (): number => 0 });

  startExpirySweep(
    {
      getAllTransfers: (): FileTransfer[] => Object.values(store),
      getTransfer: (id: string): FileTransfer | undefined => store[id],
      setTransfer: (t: FileTransfer): void => { store[t.id] = t; },
    },
    (t: FileTransfer): void => { emitted.push(t); },
    async (t: FileTransfer): Promise<void> => { saved.push(t); },
  );

  return { saved, emitted, store };
}

describe('the expiry sweep', () => {
  it('persists the expired state, not just the in-memory one', () => {
    const h: Harness = run([transfer()]);

    expect(h.store['t-1'].state, 'the in-memory state was not updated').toBe('expired');
    expect(
      h.saved.map((t) => t.state),
      'the record stayed pending on disk, so a reload restores the Accept button',
    ).toEqual(['expired']);
  });

  it('still tells the UI', () => {
    // The opposite failure: persisting instead of emitting would leave the open
    // conversation showing a live Accept button until the next reload.
    const h: Harness = run([transfer()]);

    expect(h.emitted.map((t) => t.id)).toEqual(['t-1']);
  });

  it('leaves an offer that has not expired alone', () => {
    // The sweep must not expire a live offer, and the assertions above would
    // pass just as well if it expired everything.
    const h: Harness = run([transfer({ id: 't-2', expiresAt: 99_000 })]);

    expect(h.saved).toEqual([]);
    expect(h.store['t-2'].state).toBe('pending');
  });
});

/**
 * And the service has to hand it the real saver.
 *
 * The parameter is required, so TypeScript catches a caller that forgets it
 * entirely — but a no-op function satisfies the type just as well, and the tests
 * above pass against one. Verified by control: replacing the argument with
 * `async () => undefined` leaves all 83 file-transfer tests green while the
 * record stays `'pending'` on disk exactly as before.
 *
 * There is one construction site, so this reads it.
 */
describe('the service', () => {
  it('gives the sweep its real persistence, not a stub', () => {
    const source: string = readFileSync(
      join(process.cwd(), 'src/lib/file-transfer/service.ts'),
      'utf8',
    );
    const call: number = source.indexOf('startExpirySweep(');
    expect(call, 'nothing starts the expiry sweep any more').toBeGreaterThan(-1);

    // To the end of the STATEMENT: the first ')' is inside .bind(this), which
    // truncated the arguments before the one under test and failed on correct code.
    const args: string = source.slice(call, source.indexOf(');', call));
    expect(
      args,
      'the sweep was handed something other than the service\'s saveTransfer, so an \
expired offer is still `pending` on disk and comes back on the next reload',
    ).toContain('this.saveTransfer');
  });
});
