/**
 * Placement over the real engine and the runtime's Intl: each kind of entry lands on the right
 * day at the right minute of the display zone, says what it is without colour (busy, cancelled,
 * inherited), and an entry the core cannot place is listed, not guessed.
 */
import { describe, expect, it } from 'vitest';
import type { CivilDate } from '../generated/CivilDate';
import { place, type Chip, type Placement } from '../placement';
import { realEngine } from './engine-rig';
import { bobsBusy, cancelled, inherited, JULY_WEEK, lateRelease, nowhere, offsite, standup, upPulled, VIEWER, weekly } from './placement-fixture';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const week = (y: number, m: number, d: number): CivilDate[] => engine.weekOf({ y, m, d });
const on = (p: Placement, day: string): Chip[] => p.days.get(day) ?? [];
const timed = (c: Chip | undefined): [number, number] => {
  if (c?.span.kind !== 'timed') throw new Error('not a timed chip');
  return [c.span.fromMinute, c.span.toMinute];
};

describe('placing a node calendar on a week', () => {
  const p: Placement = place(JULY_WEEK, week(2024, 7, 15), 'America/New_York', VIEWER, engine);

  it('puts a one-off event at its wall time in the display zone', () => {
    const chip: Chip | undefined = on(p, '2024-07-15').find((c) => c.entryKey === standup.key);
    expect(timed(chip)).toEqual([9 * 60, 9 * 60 + 30]);
    expect(chip).toMatchObject({ title: 'Standup', origin: 'own', cancelled: false, linked: true });
  });

  it('cuts an event that crosses midnight at the day edge', () => {
    expect(timed(on(p, '2024-07-15').find((c) => c.entryKey === lateRelease.key))).toEqual([23 * 60, 1440]);
    expect(timed(on(p, '2024-07-16').find((c) => c.entryKey === lateRelease.key))).toEqual([0, 2 * 60]);
  });

  it('shows another member’s busy-only event as busy, with no title', () => {
    expect(on(p, '2024-07-18').find((c) => c.entryKey === bobsBusy.key)?.title).toBeNull();
    const mine: Placement = place([bobsBusy], week(2024, 7, 15), 'America/New_York', 'bob', engine);
    expect(on(mine, '2024-07-18')[0]?.title).toBe('Dentist');
  });

  it('marks a cancelled event cancelled', () => {
    expect(on(p, '2024-07-17').find((c) => c.entryKey === cancelled.key)?.cancelled).toBe(true);
  });

  it('puts an all-day event on each of its days, before the timed ones', () => {
    expect(on(p, '2024-07-18')[0]).toMatchObject({ entryKey: offsite.key, span: { kind: 'all_day' } });
    expect(on(p, '2024-07-19')[0]).toMatchObject({ entryKey: offsite.key, span: { kind: 'all_day' } });
    expect(on(p, '2024-07-20').some((c) => c.entryKey === offsite.key)).toBe(false);
  });

  it('names where inherited and up-pulled events come from, and withholds a link it may not follow', () => {
    expect(on(p, '2024-07-15').find((c) => c.entryKey === inherited.key)).toMatchObject({ origin: 'inherited', fromNode: 'company', linked: false, title: 'All-hands' });
    expect(on(p, '2024-07-15').find((c) => c.entryKey === upPulled.key)).toMatchObject({ origin: 'up_pulled', fromNode: 'team-d', linked: true });
  });

  it('orders a day by start', () => {
    expect(on(p, '2024-07-15').map((c) => c.entryKey)).toEqual([standup.key, upPulled.key, inherited.key, lateRelease.key]);
  });
});

describe('placing across zones and DST', () => {
  it('keeps a New York 09:00 weekly at 09:00 in New York while London sees it move', () => {
    const london = (d: number, m: number): number => timed(place([weekly], week(2026, m, d), 'Europe/London', VIEWER, engine).days.get(`2026-0${m}-${String(d).padStart(2, '0')}`)?.[0])[0];
    expect(london(2, 3)).toBe(14 * 60);
    expect(london(9, 3)).toBe(13 * 60);
    expect(london(30, 3)).toBe(14 * 60);
    const ny: Placement = place([weekly], week(2026, 3, 9), 'America/New_York', VIEWER, engine);
    expect(timed(ny.days.get('2026-03-09')?.[0])).toEqual([9 * 60, 9 * 60 + 30]);
  });

  it('lists an event in a zone the database does not know as unplaced, with the reason', () => {
    const p: Placement = place([nowhere, standup], week(2024, 7, 15), 'America/New_York', VIEWER, engine);
    expect(p.unplaced).toEqual([{ entryKey: nowhere.key, title: 'Mars sync', code: 'unknown_zone' }]);
    expect(on(p, '2024-07-15').map((c) => c.entryKey)).toEqual([standup.key]);
  });
});
