/**
 * Where each entry falls on the days a view shows, in the member's display zone (design §3.4,
 * §3.9). A one-off event is its instants; an all-day event is its civil dates, the same for
 * every reader; a recurring event is expanded by the core in its own zone. A timed occurrence
 * that crosses midnight is cut at each day's edge. An entry the core cannot place is listed as
 * unplaced with the core's reason, never guessed.
 */
import { CalendarRefusal, type CalendarEngine } from './engine/calendar-engine';
import { dateKey } from './grid-keyboard';
import type { CivilDate } from './generated/CivilDate';
import type { RefusalCode } from './generated/RefusalCode';
import type { When } from './generated/When';
import type { CalendarEntry } from './store';
import type { Expansion } from './generated/Expansion';
import type { Projection } from './generated/Projection';
import type { Event } from './generated/Event';

export type PlacementEngine = Pick<CalendarEngine, 'instantOf' | 'civilOf' | 'expand' | 'addDays'>;

export type ChipOrigin = 'own' | 'inherited' | 'up_pulled';
export type ChipSpan =
  | { kind: 'all_day' }
  /** `fromMinute`/`toMinute`: the part of this day it covers, 0 to 1440, on the display zone's clock. */
  | { kind: 'timed'; startMs: bigint; endMs: bigint; fromMinute: number; toMinute: number };

export interface Chip {
  /** Unique within a day: the entry and the occurrence. */
  id: string;
  entryKey: string;
  /** Null when the reader is shown only that the time is busy. */
  title: string | null;
  span: ChipSpan;
  origin: ChipOrigin;
  /** The node an inherited or up-pulled event comes from. */
  fromNode: string | null;
  /** Whether the reader may open the origin. */
  linked: boolean;
  cancelled: boolean;
  /** The zone the event was made in; a badge shows when it is not the display zone. */
  zone: string;
}

export interface Unplaced {
  entryKey: string;
  title: string | null;
  code: RefusalCode;
}

export interface Placement {
  /** The instant the first day starts at, on the display zone's clock. */
  fromMs: bigint;
  days: ReadonlyMap<string, Chip[]>;
  unplaced: Unplaced[];
  /** A recurrence held more occurrences in the range than the core expands. */
  truncated: boolean;
}

type Base = Omit<Chip, 'id' | 'span'>;

function describe(entry: CalendarEntry, viewer: string): { base: Base; when: When } {
  if (entry.source === 'inherited') {
    const p: Projection = entry.projection;
    const base: Base = { entryKey: entry.key, title: p.title, origin: 'inherited', fromNode: p.origin_node, linked: entry.linked, cancelled: false, zone: p.zone };
    return { base, when: p.when };
  }
  const e: Event = entry.event;
  const busy: boolean = e.visibility === 'busy_only' && e.author !== viewer;
  const upPulled: boolean = entry.source === 'up_pulled';
  const base: Base = {
    entryKey: entry.key, title: busy ? null : e.title, origin: upPulled ? 'up_pulled' : 'own',
    fromNode: upPulled ? e.origin_node : null, linked: true, cancelled: e.status !== 'confirmed', zone: e.zone,
  };
  return { base, when: e.when };
}

function byStart(a: Chip, b: Chip): number {
  if (a.span.kind !== b.span.kind) return a.span.kind === 'all_day' ? -1 : 1;
  if (a.span.kind === 'timed' && b.span.kind === 'timed' && a.span.startMs !== b.span.startMs) return a.span.startMs < b.span.startMs ? -1 : 1;
  return (a.title ?? '').localeCompare(b.title ?? '');
}

export function place(entries: Iterable<CalendarEntry>, days: CivilDate[], displayZone: string, viewer: string, engine: PlacementEngine): Placement {
  const last: CivilDate | undefined = days[days.length - 1];
  if (last === undefined) throw new Error('a view places entries on at least one day');
  const edges: bigint[] = [...days, engine.addDays(last, 1)].map((date: CivilDate): bigint => engine.instantOf(displayZone, { date, minute: 0 }));
  const from: bigint = edges[0] as bigint;
  const to: bigint = edges[edges.length - 1] as bigint;
  const keys: string[] = days.map(dateKey);
  const placed: Map<string, Chip[]> = new Map(keys.map((k: string): [string, Chip[]] => [k, []]));
  const unplaced: Unplaced[] = [];
  let truncated: boolean = false;

  const putTimed = (base: Base, startMs: bigint, endMs: bigint): void => {
    days.forEach((_day: CivilDate, i: number): void => {
      const dayStart: bigint = edges[i] as bigint;
      const dayEnd: bigint = edges[i + 1] as bigint;
      const zeroLength: boolean = startMs === endMs && startMs >= dayStart && startMs < dayEnd;
      if (!zeroLength && (startMs >= dayEnd || endMs <= dayStart)) return;
      const fromMinute: number = startMs <= dayStart ? 0 : engine.civilOf(displayZone, startMs).minute;
      const toMinute: number = endMs >= dayEnd ? 1440 : engine.civilOf(displayZone, endMs).minute;
      placed.get(keys[i] as string)?.push({ ...base, id: `${base.entryKey}#${startMs}`, span: { kind: 'timed', startMs, endMs, fromMinute, toMinute } });
    });
  };

  for (const entry of entries) {
    const { base, when } = describe(entry, viewer);
    try {
      if ('once' in when) {
        putTimed(base, when.once.start_ms, when.once.end_ms);
      } else if ('all_day' in when) {
        let date: CivilDate = when.all_day.date;
        const lastKey: string = dateKey(last);
        for (let n: number = 0; n < when.all_day.days && dateKey(date) <= lastKey; n++, date = engine.addDays(date, 1)) {
          placed.get(dateKey(date))?.push({ ...base, id: `${base.entryKey}#${dateKey(when.all_day.date)}`, span: { kind: 'all_day' } });
        }
      } else {
        const expansion: Expansion = engine.expand(when.recurring, base.zone, from, to);
        truncated ||= expansion.truncated;
        for (const o of expansion.occurrences) putTimed(base, o.start_ms, o.end_ms);
      }
    } catch (thrown: unknown) {
      if (!(thrown instanceof CalendarRefusal)) throw thrown;
      unplaced.push({ entryKey: base.entryKey, title: base.title, code: thrown.code });
    }
  }
  for (const chips of placed.values()) chips.sort(byStart);
  return { fromMs: from, days: placed, unplaced, truncated };
}
