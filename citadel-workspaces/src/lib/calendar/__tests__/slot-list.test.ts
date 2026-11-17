/**
 * The booking page's slot list over the real engine: it is exactly the core's answer for the
 * type's own rules, regrouped when the invitee changes zone, and the type's minimum notice holds.
 */
import { describe, expect, it } from 'vitest';
import type { Availability } from '../generated/Availability';
import type { EventType } from '../generated/EventType';
import type { Interval } from '../generated/Interval';
import { slotDays, slotRequest, slotZone, type SlotInput } from '../slot-list';
import { NY, realEngine, utc } from './engine-rig';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const evening: { start_min: number; end_min: number; }[] = [{ start_min: 17 * 60, end_min: 20 * 60 }];
const availability: Availability = { id: 'a1', name: 'Evenings', zone: NY, weekly: [evening, evening, evening, evening, evening, [], []], overrides: [] };
const type: EventType = {
  id: 't1', name: 'Intro call', kind: 'one_on_one', durations_min: [30, 60], questions: [], color: 'primary', locked: false, zone_lock: null,
  rules: { buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 4 * 60, max_per_day: null, increment_min: 30, range: 'indefinite', cancel_policy: null },
};
const input: SlotInput = {
  type, durationMin: 60, availability, busy: [], booked: [],
  nowMs: utc('2024-07-15T18:30:00Z'), from: { y: 2024, m: 7, d: 15 }, to: { y: 2024, m: 7, d: 16 },
};
const starts = (slots: Interval[]): string[] => slots.map((s) => new Date(Number(s.start_ms)).toISOString());

describe('the booking page slot list', () => {
  it("lists exactly the core's slots for the type's rules", () => {
    const core: Interval[] = engine.freeSlots(slotRequest(input));
    expect(slotDays(core, NY, engine).flatMap((d) => d.slots)).toEqual(core);
  });

  it('holds the minimum notice: nothing starts within four hours of now', () => {
    const offered: string[] = starts(engine.freeSlots(slotRequest(input)));
    expect(offered[0]).toBe('2024-07-15T22:30:00.000Z');
    expect(offered).not.toContain('2024-07-15T22:00:00.000Z');
  });

  it('regroups by the day each slot starts on in the zone the invitee picks', () => {
    const core: Interval[] = engine.freeSlots(slotRequest(input));
    const ny: number[][] = slotDays(core, NY, engine).map((d) => [d.date.d, d.slots.length]);
    const london: number[][] = slotDays(core, 'Europe/London', engine).map((d) => [d.date.d, d.slots.length]);
    expect(ny).toEqual([[15, 2], [16, 5]]);
    expect(london).toEqual([[15, 1], [16, 5], [17, 1]]);
  });

  it('refuses a duration the type does not offer, and shows a locked type in its own zone', () => {
    expect(() => slotRequest({ ...input, durationMin: 45 })).toThrow(/not offered for 45/);
    expect(slotZone(type, 'Europe/London')).toBe('Europe/London');
    expect(slotZone({ ...type, zone_lock: NY }, 'Europe/London')).toBe(NY);
  });
});
