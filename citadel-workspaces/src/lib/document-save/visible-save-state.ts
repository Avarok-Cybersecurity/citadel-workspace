/**
 * What the title bar shows, from where the edits are (saveStatus) and how long they have been on
 * their way. Pure, with the clock passed in: the component asks it again at `wakeAt`.
 *
 * Google Docs' rule: a save is not news. With AutoSave on, every keystroke starts one that ends
 * a moment later, and showing each made the title bar flicker "Saving… / Saved" as people typed.
 * So a pending save changes nothing on screen until it has taken longer than
 * `showSavingAfterMs`, and once "Saving…" is shown it stays at least `minSavingShownMs`, so it
 * never flashes. Anything that needs the person -- offline, not kept on this device, refused,
 * locked -- shows at once and stays while it holds. The persistence cadence is not touched: this
 * only decides what is drawn.
 */
import type { SaveStatus } from './save-status';

export interface SaveIndicatorTiming {
  /** A save pending at most this long changes nothing on screen. */
  readonly showSavingAfterMs: number;
  /** Once shown, "Saving…" stays at least this long. */
  readonly minSavingShownMs: number;
}

/** The states a short save may stay behind: nothing in them needs the person's attention. */
const QUIET: ReadonlySet<SaveStatus> = new Set<SaveStatus>(['saved', 'savedToDevice']);

export function isQuietSaveStatus(status: SaveStatus): boolean {
  return QUIET.has(status);
}

export interface SaveIndicatorMemory {
  /** When the current run of `saving` began; null while nothing is on its way. */
  readonly pendingSince: number | null;
  /** When "Saving…" went on screen; null while it is not shown. */
  readonly savingShownAt: number | null;
  /** The last state other than `saving`: what stays on screen during a short save. */
  readonly settled: SaveStatus;
}

/** A document opens with everything saved until its session says otherwise. */
export const INITIAL_SAVE_INDICATOR: SaveIndicatorMemory = { pendingSince: null, savingShownAt: null, settled: 'saved' };

export interface VisibleSave {
  readonly shown: SaveStatus;
  readonly memory: SaveIndicatorMemory;
  /** When to ask again; null when nothing changes without a new status. */
  readonly wakeAt: number | null;
}

export function visibleSaveState(status: SaveStatus, memory: SaveIndicatorMemory, now: number, timing: SaveIndicatorTiming): VisibleSave {
  if (status === 'saving') {
    const pendingSince: number = memory.pendingSince ?? now;
    const due: number = pendingSince + timing.showSavingAfterMs;
    // After a problem (offline, refused…), progress towards fixing it is news: shown at once.
    if (memory.savingShownAt !== null || now >= due || !isQuietSaveStatus(memory.settled)) {
      return { shown: 'saving', memory: { pendingSince, savingShownAt: memory.savingShownAt ?? now, settled: memory.settled }, wakeAt: null };
    }
    return { shown: memory.settled, memory: { pendingSince, savingShownAt: null, settled: memory.settled }, wakeAt: due };
  }
  const settledMemory: SaveIndicatorMemory = { pendingSince: null, savingShownAt: null, settled: status };
  if (memory.savingShownAt !== null && isQuietSaveStatus(status)) {
    const until: number = memory.savingShownAt + timing.minSavingShownMs;
    if (now < until) return { shown: 'saving', memory: { ...settledMemory, savingShownAt: memory.savingShownAt }, wakeAt: until };
  }
  return { shown: status, memory: settledMemory, wakeAt: null };
}
