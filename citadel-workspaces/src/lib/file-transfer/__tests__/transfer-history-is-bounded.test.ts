/**
 * The persisted transfer map must not grow for the life of the profile.
 *
 * `persistTransfer` reads the whole `citadel:file-transfers` map, replaces one
 * entry and writes the whole map back — on every state change, including each
 * progress tick. Nothing removed an entry, so the cost of recording one
 * transfer's progress grew with every transfer the browser had ever seen, and
 * the map grew without limit.
 *
 * The end of that is a localStorage quota error inside a `catch {}` whose
 * comment says losing the record costs history and not a transfer — true only
 * while the map is bounded. Unbounded, the write that finally fails is the one
 * recording a transfer still in flight, and the bubble loses the record that
 * Accept, Decline and Cancel need.
 */
import { describe, it, expect } from 'vitest';
import {
  pruneTransfers,
  TRANSFER_HISTORY_MS,
  TRANSFER_HISTORY_MAX,
} from '../prune-transfers';
import type { FileTransfer } from '../types';

const NOW: number = 1_700_000_000_000;

function record(id: string, state: string, updatedAt: number): Partial<FileTransfer> {
  return { id, state: state as FileTransfer['state'], updatedAt };
}

function mapOf(...records: Partial<FileTransfer>[]): Record<string, Partial<FileTransfer>> {
  return Object.fromEntries(records.map((r) => [r.id as string, r]));
}

describe('pruning the transfer history', () => {
  it('keeps an unfinished transfer however old it is', () => {
    // Dropping one drops the only record Accept, Decline and Cancel work from
    // -- which is the bug the persistence layer was written to fix.
    const ancient: number = NOW - TRANSFER_HISTORY_MS * 10;
    const kept: Record<string, Partial<FileTransfer>> = pruneTransfers(
      mapOf(
        record('a', 'pending', ancient),
        record('b', 'transferring', ancient),
        record('c', 'queued', ancient),
      ),
      NOW,
    );
    expect(Object.keys(kept).sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops a finished transfer once it is older than the window', () => {
    const kept: Record<string, Partial<FileTransfer>> = pruneTransfers(
      mapOf(
        record('recent', 'complete', NOW - 1000),
        record('stale', 'complete', NOW - TRANSFER_HISTORY_MS - 1),
      ),
      NOW,
    );
    expect(Object.keys(kept)).toEqual(['recent']);
  });

  it('caps a burst inside the window, newest kept', () => {
    const many: Partial<FileTransfer>[] = Array.from({ length: TRANSFER_HISTORY_MAX + 50 }, (_, i): Partial<FileTransfer> =>
      record(`t${i}`, 'complete', NOW - i),
    );
    const kept: Record<string, Partial<FileTransfer>> = pruneTransfers(mapOf(...many), NOW);
    expect(Object.keys(kept)).toHaveLength(TRANSFER_HISTORY_MAX);
    expect(kept['t0']).toBeDefined();
    expect(kept[`t${TRANSFER_HISTORY_MAX + 49}`]).toBeUndefined();
  });

  it('does not let the cap evict an unfinished transfer', () => {
    // The cap applies to history. A live transfer is not history, and losing it
    // to a burst of completed ones would be the original bug with extra steps.
    const many: Partial<FileTransfer>[] = Array.from({ length: TRANSFER_HISTORY_MAX + 50 }, (_, i): Partial<FileTransfer> =>
      record(`t${i}`, 'complete', NOW - i),
    );
    const kept: Record<string, Partial<FileTransfer>> = pruneTransfers(mapOf(...many, record('live', 'pending', NOW - 999_999)), NOW);
    expect(kept['live']).toBeDefined();
  });

  it('treats every terminal state as history, not just complete', () => {
    const stale: number = NOW - TRANSFER_HISTORY_MS - 1;
    const kept: Record<string, Partial<FileTransfer>> = pruneTransfers(
      mapOf(
        record('a', 'declined', stale),
        record('b', 'cancelled', stale),
        record('c', 'expired', stale),
        record('d', 'error', stale),
      ),
      NOW,
    );
    expect(Object.keys(kept)).toEqual([]);
  });

  it('keeps a record with no timestamps rather than treating it as ancient', () => {
    // A record written before updatedAt existed reads as epoch 0, which would
    // silently delete on the first save after an upgrade. Unfinished ones are
    // safe by state; a finished one with no timestamp is genuinely old and
    // going is correct -- but it must be the STATE that decides, not a
    // fabricated date.
    const kept: Record<string, Partial<FileTransfer>> = pruneTransfers(mapOf({ id: 'x', state: 'transferring' }), NOW);
    expect(kept['x']).toBeDefined();
  });
});
