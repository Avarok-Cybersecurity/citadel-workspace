import { exportDrafts, importDrafts } from './draft-store';
import { debugLog } from '@/lib/debug-config';

/**
 * Carry unsent drafts across a reload the app asks for.
 *
 * The update banner and the superseded-chunk recovery both reload the page, and
 * drafts live in memory (draft-store), so either one silently threw away a
 * half-written message. Now the drafts go into sessionStorage immediately
 * before that reload, and the next load takes them back and deletes the entry
 * on first read — so they exist outside memory only across that one reload,
 * only in this tab, and never for a reload the app did not start.
 */
export const DRAFT_HANDOFF_KEY: string = 'citadel:draft-handoff';

/** The part of `Storage` this needs, so a test can hand in its own. */
export type HandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isEntry(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string';
}

/** Drafts are plain strings, so JSON carries them exactly; no CID is involved. */
export function stashDrafts(storage: HandoffStorage, entries: ReadonlyArray<readonly [string, string]>): void {
  if (entries.length === 0) {
    storage.removeItem(DRAFT_HANDOFF_KEY);
    return;
  }
  storage.setItem(DRAFT_HANDOFF_KEY, JSON.stringify(entries));
}

/** Read and delete. Anything that is not the shape written above is discarded. */
export function takeStashedDrafts(storage: HandoffStorage): Array<[string, string]> {
  const raw: string | null = storage.getItem(DRAFT_HANDOFF_KEY);
  storage.removeItem(DRAFT_HANDOFF_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    debugLog('DraftHandoff', 'Discarding an unreadable draft handoff', error);
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
}

/**
 * sessionStorage, or null where the browser refuses it (blocked site data, some
 * private modes). Drafts are then lost on reload, as they always were before.
 */
export function browserSessionStorage(): HandoffStorage | null {
  try {
    return window.sessionStorage;
  } catch (error: unknown) {
    debugLog('DraftHandoff', 'sessionStorage is unavailable', error);
    return null;
  }
}

/** Stash this tab's drafts, then reload. The single reload path the app starts. */
export function reloadKeepingDrafts(storage: HandoffStorage | null, reload: () => void): void {
  if (storage) {
    try {
      stashDrafts(storage, exportDrafts());
    } catch (error: unknown) {
      // Quota or a revoked storage: the reload the user asked for still happens.
      debugLog('DraftHandoff', 'Could not stash drafts before reloading', error);
    }
  }
  reload();
}

/** At startup, before anything renders a composer. */
export function restoreHandedOffDrafts(storage: HandoffStorage | null): void {
  if (!storage) return;
  try {
    importDrafts(takeStashedDrafts(storage));
  } catch (error: unknown) {
    debugLog('DraftHandoff', 'Could not restore drafts after a reload', error);
  }
}
