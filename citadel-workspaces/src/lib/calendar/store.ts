/**
 * The Calendar's state (design §3.9): which view, which day has focus, and what the ports have
 * read, by where it was read from. A pure reducer; the ports (C3) dispatch what they read and
 * the views derive everything else (`placement.ts`). Nothing here has a default: the first view
 * and today come from the caller, which knows the screen and the member's zone.
 */
import type { CivilDate } from './generated/CivilDate';
import type { Event } from './generated/Event';
import type { Projection } from './generated/Projection';

export type CalendarView = 'month' | 'week' | 'day' | 'agenda';

/**
 * Where an entry was read: the node's official events (`node`), events members posted on it
 * (`authored`), an ancestor's projection (`inherited`), a descendant's event whose `up_to`
 * reaches this node (`up_pulled`), or the member's own private events (`private`).
 */
export type EntrySource = 'node' | 'authored' | 'inherited' | 'up_pulled' | 'private';

export type EventEntry = { key: string; source: Exclude<EntrySource, 'inherited'>; event: Event };
/** `linked`: the reader may open the origin (the core's `reconcile` said `show`, not `show_without_link`). */
export type InheritedEntry = { key: string; source: 'inherited'; projection: Projection; linked: boolean };
export type CalendarEntry = EventEntry | InheritedEntry;

/**
 * `unreadable`: values under the source the core could not decode, left out and counted (read-sources.ts).
 * `limitedTo`: the number of pages it was read from when more lay below than the core's bound, else null.
 */
export type LoadState = { kind: 'loading' } | { kind: 'ready'; unreadable: number; limitedTo: number | null } | { kind: 'failed'; reason: string };

export interface CalendarState {
  view: CalendarView;
  /** The focused day; every view's range is derived from it. */
  cursor: CivilDate;
  entries: ReadonlyMap<string, CalendarEntry>;
  /** One per source: a source that failed says so without hiding what the others read. */
  loads: ReadonlyMap<EntrySource, LoadState>;
}

export type CalendarAction =
  | { type: 'view'; view: CalendarView }
  | { type: 'focus'; date: CivilDate }
  | { type: 'loading'; source: EntrySource }
  /** Everything `source` holds now: its earlier entries are replaced, not merged. */
  | { type: 'read'; source: EntrySource; entries: CalendarEntry[]; unreadable: number; limitedTo: number | null }
  | { type: 'failed'; source: EntrySource; reason: string }
  | { type: 'removed'; key: string };

export function initialCalendar(view: CalendarView, today: CivilDate): CalendarState {
  return { view, cursor: today, entries: new Map(), loads: new Map() };
}

function withLoad(state: CalendarState, source: EntrySource, load: LoadState): ReadonlyMap<EntrySource, LoadState> {
  const loads: Map<EntrySource, LoadState> = new Map(state.loads);
  loads.set(source, load);
  return loads;
}

function replaceSource(state: CalendarState, source: EntrySource, read: CalendarEntry[]): ReadonlyMap<string, CalendarEntry> {
  const entries: Map<string, CalendarEntry> = new Map();
  for (const [key, entry] of state.entries) if (entry.source !== source) entries.set(key, entry);
  for (const entry of read) {
    if (entry.source !== source) throw new Error(`an entry read from ${source} says it came from ${entry.source}`);
    if (entries.has(entry.key)) throw new Error(`two entries share the key ${entry.key}`);
    entries.set(entry.key, entry);
  }
  return entries;
}

export function calendarReducer(state: CalendarState, action: CalendarAction): CalendarState {
  switch (action.type) {
    case 'view':
      return { ...state, view: action.view };
    case 'focus':
      return { ...state, cursor: action.date };
    case 'loading':
      return { ...state, loads: withLoad(state, action.source, { kind: 'loading' }) };
    case 'read':
      return { ...state, entries: replaceSource(state, action.source, action.entries), loads: withLoad(state, action.source, { kind: 'ready', unreadable: action.unreadable, limitedTo: action.limitedTo }) };
    case 'failed':
      return { ...state, loads: withLoad(state, action.source, { kind: 'failed', reason: action.reason }) };
    case 'removed': {
      if (!state.entries.has(action.key)) return state;
      const entries: Map<string, CalendarEntry> = new Map(state.entries);
      entries.delete(action.key);
      return { ...state, entries };
    }
  }
}

/** An entry's key: where it was read, so two sources never collide and a re-read replaces it. */
export function entryKey(source: EntrySource, node: string, author: string | null, storageKey: string): string {
  return [source, node, author ?? '', storageKey].map(encodeURIComponent).join('/');
}
