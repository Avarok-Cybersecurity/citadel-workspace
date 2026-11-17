/**
 * What a key does in a Calendar grid (design §3.10): the grid is one tab stop, and the keys move
 * the focused day within it. Arrows move a day (and a week up or down in Month); PageUp/PageDown
 * move a month in Month and a week in Week and Day; Home/End go to the week's Monday and Sunday;
 * Enter or Space opens the day; `+` or `n` creates on it. Dates come from the core's own civil
 * arithmetic (`GridNav` is the engine's), so the grid and the recurrence agree on every day.
 */
import type { CivilDate } from './generated/CivilDate';

export type GridView = 'month' | 'week' | 'day';

export type GridIntent =
  | { kind: 'focus'; date: CivilDate }
  | { kind: 'open'; date: CivilDate }
  | { kind: 'create'; date: CivilDate };

/** The engine's date arithmetic, which is all a key needs. */
export interface GridNav {
  addDays(date: CivilDate, days: number): CivilDate;
  addMonths(date: CivilDate, months: number): CivilDate;
  weekOf(date: CivilDate): CivilDate[];
}

const DAYS_A_WEEK: number = 7;

function weekEdge(nav: GridNav, focused: CivilDate, edge: 'first' | 'last'): CivilDate {
  const week: CivilDate[] = nav.weekOf(focused);
  const day: CivilDate | undefined = edge === 'first' ? week[0] : week[week.length - 1];
  if (day === undefined) throw new Error('the core returned an empty week');
  return day;
}

function page(view: GridView, nav: GridNav, focused: CivilDate, direction: 1 | -1): CivilDate {
  return view === 'month' ? nav.addMonths(focused, direction) : nav.addDays(focused, direction * DAYS_A_WEEK);
}

/** The intent of `key` on `focused`, or null when the key is not the grid's (it is left alone). */
export function gridIntent(key: string, focused: CivilDate, view: GridView, nav: GridNav): GridIntent | null {
  const focus = (date: CivilDate): GridIntent => ({ kind: 'focus', date });
  switch (key) {
    case 'ArrowLeft':
      return focus(nav.addDays(focused, -1));
    case 'ArrowRight':
      return focus(nav.addDays(focused, 1));
    case 'ArrowUp':
      return view === 'month' ? focus(nav.addDays(focused, -DAYS_A_WEEK)) : null;
    case 'ArrowDown':
      return view === 'month' ? focus(nav.addDays(focused, DAYS_A_WEEK)) : null;
    case 'PageUp':
      return focus(page(view, nav, focused, -1));
    case 'PageDown':
      return focus(page(view, nav, focused, 1));
    case 'Home':
      return focus(weekEdge(nav, focused, 'first'));
    case 'End':
      return focus(weekEdge(nav, focused, 'last'));
    case 'Enter':
    case ' ':
      return { kind: 'open', date: focused };
    case '+':
    case 'n':
      return { kind: 'create', date: focused };
    default:
      return null;
  }
}

export const sameDate = (a: CivilDate, b: CivilDate): boolean => a.y === b.y && a.m === b.m && a.d === b.d;

/** A date as a stable string, for React keys, Map keys and DOM ids. */
export const dateKey = (date: CivilDate): string =>
  `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
