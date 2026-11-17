/**
 * What the booking page lists (design §3.6.1, §3.9): the core's free slots for one event type and
 * one of its durations, grouped by the day they start on in the zone the invitee reads in. The
 * request is built here, once, from the type's own rules, so the page cannot ask the core a
 * looser question than the host's instance will check at claim.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { Availability } from './generated/Availability';
import type { BookedDay } from './generated/BookedDay';
import type { CivilDate } from './generated/CivilDate';
import type { EventType } from './generated/EventType';
import type { Interval } from './generated/Interval';
import type { SlotRequest } from './generated/SlotRequest';
import { dateKey } from './grid-keyboard';

export interface SlotInput {
  type: EventType;
  durationMin: number;
  availability: Availability;
  /** The host's busy intervals: their events and their published free/busy. */
  busy: Interval[];
  booked: BookedDay[];
  nowMs: bigint;
  from: CivilDate;
  to: CivilDate;
}

export function slotRequest(input: SlotInput): SlotRequest {
  if (!input.type.durations_min.includes(input.durationMin)) {
    throw new Error(`${input.type.name} is not offered for ${input.durationMin} minutes`);
  }
  return {
    availability: input.availability, rules: input.type.rules, duration_min: input.durationMin,
    busy: input.busy, booked: input.booked, now_ms: input.nowMs, from: input.from, to: input.to,
  };
}

/** The zone a booking page shows times in: the type's lock, or the invitee's choice. */
export const slotZone = (type: EventType, chosen: string): string => type.zone_lock ?? chosen;

export interface SlotDay {
  date: CivilDate;
  slots: Interval[];
}

/** Slots grouped by the day each starts on in `zone`, in order; days with none are absent. */
export function slotDays(slots: readonly Interval[], zone: string, engine: Pick<CalendarEngine, 'civilOf'>): SlotDay[] {
  const days: Map<string, SlotDay> = new Map();
  const ordered: Interval[] = [...slots].sort((a: Interval, b: Interval): number => (a.start_ms < b.start_ms ? -1 : a.start_ms > b.start_ms ? 1 : 0));
  for (const slot of ordered) {
    const date: CivilDate = engine.civilOf(zone, slot.start_ms).date;
    const key: string = dateKey(date);
    const day: SlotDay | undefined = days.get(key);
    if (day === undefined) days.set(key, { date, slots: [slot] });
    else day.slots.push(slot);
  }
  return [...days.values()];
}
