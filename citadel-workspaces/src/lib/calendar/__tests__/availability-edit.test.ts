/**
 * The availability editor's checks: times typed as HH:MM, each window a real span, no two
 * overlapping, one override per date; and a saved schedule gives the core's slots for exactly the
 * hours typed.
 */
import { describe, expect, it } from 'vitest';
import { checkAvailability, checkWindows, clockText, draftOf, parseClock, type AvailabilityDraft } from '../availability-edit';
import type { Availability } from '../generated/Availability';
import { slotRequest } from '../slot-list';
import { NY, realEngine, utc } from './engine-rig';
import { INTRO } from './booking-fixture';
import type { Interval } from '@/lib/calendar/generated/Interval';
import type { AvailabilityCheck } from '@/lib/calendar/availability-edit';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const known = (zone: string): boolean => zone === NY || zone === 'Europe/London';
const none: AvailabilityDraft['weekly'] = [[], [], [], [], [], [], []];
const mornings: AvailabilityDraft = { name: 'Mornings', zone: NY, weekly: [[{ start: '09:00', end: '12:00' }], ...none.slice(1)], overrides: [] };

describe('the availability editor', () => {
  it('reads HH:MM up to the end of the day and nothing else', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('24:00')).toBe(1440);
    for (const bad of ['9:30', '24:01', '25:00', '09:60', 'noon', '']) expect(parseClock(bad)).toBeNull();
    expect(clockText(570)).toBe('09:30');
  });

  it('refuses a window that ends before it starts, and two that overlap; touching is fine', () => {
    expect(checkWindows([{ start: '12:00', end: '09:00' }])).toEqual({ ok: false, error: 'Hours 1: the end must be after the start.' });
    expect(checkWindows([{ start: '13:00', end: '17:00' }, { start: '09:00', end: '13:30' }])).toEqual({ ok: false, error: '13:00 starts before 13:30 ends.' });
    expect(checkWindows([{ start: '13:00', end: '17:00' }, { start: '09:00', end: '13:00' }])).toEqual({ ok: true, windows: [{ start_min: 540, end_min: 780 }, { start_min: 780, end_min: 1020 }] });
  });

  it('names the day and the date each error is on, and refuses an unknown zone and a second override of a date', () => {
    const date: { y: number; m: number; d: number; } = { y: 2024, m: 12, d: 24 };
    const draft: AvailabilityDraft = {
      name: ' ', zone: 'Mars/Olympus', weekly: [[], [{ start: '10:00', end: '09:00' }], ...none.slice(2)],
      overrides: [{ date, windows: [] }, { date, windows: [{ start: '09:00', end: '10:00' }] }],
    };
    const checked: AvailabilityCheck = checkAvailability('a1', draft, known);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect([...checked.errors.keys()].sort()).toEqual(['date-2024-12-24', 'day-1', 'name', 'zone']);
  });

  it('round-trips a saved schedule through its form unchanged', () => {
    const checked: AvailabilityCheck = checkAvailability('a1', mornings, known);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checkAvailability('a1', draftOf(checked.availability), known)).toEqual(checked);
  });

  it("gives the core's slots for exactly the hours typed", () => {
    const checked: AvailabilityCheck = checkAvailability('a1', mornings, known);
    if (!checked.ok) throw new Error('mornings should be valid');
    const availability: Availability = checked.availability;
    const slots: Interval[] = engine.freeSlots(slotRequest({
      type: INTRO, durationMin: 60, availability, busy: [], booked: [], nowMs: utc('2024-07-01T00:00:00Z'), from: { y: 2024, m: 7, d: 15 }, to: { y: 2024, m: 7, d: 16 },
    }));
    expect(slots.map((s) => new Date(Number(s.start_ms)).toISOString())).toEqual(['2024-07-15T13:00:00.000Z', '2024-07-15T13:30:00.000Z', '2024-07-15T14:00:00.000Z', '2024-07-15T14:30:00.000Z', '2024-07-15T15:00:00.000Z']);
  });
});
