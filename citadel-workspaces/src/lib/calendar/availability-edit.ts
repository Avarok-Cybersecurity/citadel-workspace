/**
 * What the availability editor decides (design §3.9 "Availability editor"): a weekly schedule of
 * windows per weekday and date overrides, edited as "HH:MM" text and checked before it is saved.
 * The core accepts any window inside the day (`slots.rs` `check`); the editor is stricter and
 * refuses windows that overlap or touch out of order, so what a member saves is what they meant.
 */
import type { Availability } from './generated/Availability';
import type { CivilDate } from './generated/CivilDate';
import type { DateOverride } from './generated/DateOverride';
import type { Window } from './generated/Window';
import { dateKey } from './grid-keyboard';

/** `MINUTES_PER_DAY` in `civil.rs`: a window may end at midnight, never after. */
export const MINUTES_PER_DAY: number = 24 * 60;

/** "09:30" → 570; "24:00" is the end of the day. Null for anything else. */
export function parseClock(text: string): number | null {
  const match: RegExpExecArray | null = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(text.trim());
  if (match === null) return null;
  const minutes: number = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= MINUTES_PER_DAY ? minutes : null;
}

/** 570 → "09:30", the form the editor's time inputs hold. */
export function clockText(minutes: number): string {
  const h: number = Math.floor(minutes / 60);
  const m: number = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface WindowText {
  start: string;
  end: string;
}

export type WindowsCheck = { ok: true; windows: Window[] } | { ok: false; error: string };

/** One day's windows from what the member typed: each a real span, in order, none overlapping. */
export function checkWindows(typed: readonly WindowText[]): WindowsCheck {
  const windows: Window[] = [];
  for (const [i, w] of typed.entries()) {
    const start: number | null = parseClock(w.start);
    const end: number | null = parseClock(w.end);
    if (start === null || end === null) return { ok: false, error: `Hours ${i + 1}: enter times as HH:MM.` };
    if (start >= end) return { ok: false, error: `Hours ${i + 1}: the end must be after the start.` };
    windows.push({ start_min: start, end_min: end });
  }
  windows.sort((a: Window, b: Window): number => a.start_min - b.start_min);
  for (let i: number = 1; i < windows.length; i += 1) {
    const before: Window = windows[i - 1] as Window;
    const after: Window = windows[i] as Window;
    if (after.start_min < before.end_min) return { ok: false, error: `${clockText(after.start_min)} starts before ${clockText(before.end_min)} ends.` };
  }
  return { ok: true, windows };
}

export const windowTexts = (windows: readonly Window[]): WindowText[] =>
  windows.map((w: Window): WindowText => ({ start: clockText(w.start_min), end: clockText(w.end_min) }));

export interface AvailabilityDraft {
  name: string;
  zone: string;
  /** Monday first, as `Availability.weekly`. */
  weekly: WindowText[][];
  overrides: { date: CivilDate; windows: WindowText[] }[];
}

export type AvailabilityCheck = { ok: true; availability: Availability } | { ok: false; errors: ReadonlyMap<string, string> };

/** Error keys: `name`, `zone`, `day-<0..6>`, `date-<yyyy-mm-dd>`. */
export function checkAvailability(id: string, draft: AvailabilityDraft, knownZone: (zone: string) => boolean): AvailabilityCheck {
  const errors: Map<string, string> = new Map();
  if (draft.name.trim() === '') errors.set('name', 'Give the schedule a name.');
  if (!knownZone(draft.zone)) errors.set('zone', `${draft.zone} is not a time zone this browser knows.`);
  if (draft.weekly.length !== 7) throw new Error(`a week has seven days, not ${draft.weekly.length}`);
  const weekly: Window[][] = draft.weekly.map((day: WindowText[], i: number): Window[] => {
    const checked: WindowsCheck = checkWindows(day);
    if (checked.ok) return checked.windows;
    errors.set(`day-${i}`, checked.error);
    return [];
  });
  const seen: Set<string> = new Set();
  const overrides: DateOverride[] = [];
  for (const o of draft.overrides) {
    const key: string = dateKey(o.date);
    if (seen.has(key)) {
      errors.set(`date-${key}`, 'This date already has its own hours.');
      continue;
    }
    seen.add(key);
    const checked: WindowsCheck = checkWindows(o.windows);
    if (checked.ok) overrides.push({ date: o.date, windows: checked.windows });
    else errors.set(`date-${key}`, checked.error);
  }
  if (errors.size > 0) return { ok: false, errors };
  return { ok: true, availability: { id, name: draft.name.trim(), zone: draft.zone, weekly: weekly as Availability['weekly'], overrides } };
}

export function draftOf(availability: Availability): AvailabilityDraft {
  return {
    name: availability.name,
    zone: availability.zone,
    weekly: availability.weekly.map(windowTexts),
    overrides: availability.overrides.map((o: DateOverride) => ({ date: o.date, windows: windowTexts(o.windows) })),
  };
}
