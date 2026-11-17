import type { FileTransfer } from './types';

/**
 * What the persisted transfer history keeps, and what it lets go.
 *
 * `persistTransfer` read the whole `citadel:file-transfers` map, replaced one
 * entry and wrote the whole map back — on every state change of every transfer,
 * including each progress tick. Nothing ever removed an entry. So the cost of
 * saving one transfer's progress grew with the number of transfers the browser
 * had ever seen, and the map grew for the life of the profile.
 *
 * Neither end of that is dramatic on its own; together they end at a
 * localStorage quota error, in a `catch {}` whose comment says losing the
 * record "costs history, not a transfer" — which stops being true once the
 * write that fails is the one recording a transfer still in flight.
 *
 * A finished transfer is history. It is worth keeping for a while, so a bubble
 * from this morning still renders with its state, and it is worth dropping
 * eventually.
 */

/** States that are still waiting on somebody, and can never be pruned. */
const UNFINISHED: ReadonlySet<string> = new Set([
  'queued',
  'preparing',
  'pending',
  'transferring',
]);

/** How long a finished transfer stays in the history. */
export const TRANSFER_HISTORY_MS: number = 7 * 24 * 60 * 60 * 1000;

/** How many finished transfers to keep regardless of age, newest first. */
export const TRANSFER_HISTORY_MAX: number = 200;

function lastTouched(t: Partial<FileTransfer>): number {
  return t.updatedAt ?? t.createdAt ?? 0;
}

/**
 * Prune the persisted map.
 *
 * Unfinished transfers survive unconditionally — dropping one is dropping the
 * only record that Accept, Decline and Cancel have to work with, which is the
 * bug `transfer-persistence.ts` was written to fix. Age is applied first and
 * the count cap second, so a burst of transfers inside the window is bounded
 * without shortening the window for everyone else.
 */
export function pruneTransfers(
  transfers: Record<string, Partial<FileTransfer>>,
  now: number,
): Record<string, Partial<FileTransfer>> {
  const entries: [string, Partial<FileTransfer>][] = Object.entries(transfers);

  const unfinished: [string, Partial<FileTransfer>][] = entries.filter(([, t]) => UNFINISHED.has(t.state ?? ''));
  const finished: [string, Partial<FileTransfer>][] = entries
    .filter(([, t]) => !UNFINISHED.has(t.state ?? ''))
    .filter(([, t]) => now - lastTouched(t) <= TRANSFER_HISTORY_MS)
    .sort((a, b) => lastTouched(b[1]) - lastTouched(a[1]))
    .slice(0, TRANSFER_HISTORY_MAX);

  return Object.fromEntries([...unfinished, ...finished]);
}
