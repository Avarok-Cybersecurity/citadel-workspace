/**
 * A team's booking page on the real core: a round robin offers a time while any host has it free
 * and names who is free then; a collective only the times every host has free; and the host a
 * round-robin time goes to is ranked with each host's confirmed bookings that month, so the host
 * with fewer takes it even when a tie would go to the other by name.
 */
import { describe, expect, it } from 'vitest';
import type { HostBusy } from '../booking-pages';
import type { EventType } from '../generated/EventType';
import type { Interval } from '../generated/Interval';
import type { CalendarEntry } from '../store';
import { confirmedCounts, freeAt, rankedFor, teamSlots, type HostSource, type SlotAsk } from '../team-slots';
import { WORKING_HOURS, INTRO } from './booking-fixture';
import { engine } from './booking-rig';
import { event, NY, utc } from './event-fixture';
import type { TeamSlots } from '@/lib/calendar/team-slots';

const team = (kind: EventType['kind']): EventType => ({ ...INTRO, id: 'team', name: 'Demo', kind, questions: [] });
const RR: EventType = team({ round_robin: { hosts: ['ana', 'bo'], strategy: 'equal' } });
const COLLECTIVE: EventType = team({ collective: { hosts: ['ana', 'bo'] } });
const ask = (type: EventType): SlotAsk => ({ type, durationMin: 30, nowMs: utc('2024-07-15T12:00:00Z'), from: { y: 2024, m: 7, d: 16 }, to: { y: 2024, m: 7, d: 16 } });
const NINE: Interval = { start_ms: utc('2024-07-16T13:00:00Z'), end_ms: utc('2024-07-16T13:30:00Z') };
const TEN: Interval = { start_ms: utc('2024-07-16T14:00:00Z'), end_ms: utc('2024-07-16T14:30:00Z') };

/** ana busy 9:00–10:00 New York on the 16th; bo free all day. */
const source: HostSource = (host: string) => ({
  availability: WORKING_HOURS,
  busyFor: (): HostBusy => ({ busy: host === 'ana' ? [{ start_ms: NINE.start_ms, end_ms: TEN.start_ms }] : [], booked: [] }),
});
const has = (slots: Interval[], s: Interval): boolean => slots.some((x: Interval) => x.start_ms === s.start_ms && x.end_ms === s.end_ms);

const booked = (id: string, host: string, start: string): CalendarEntry => ({
  key: `authored:${host}|cal/event/${id}`, source: 'authored',
  event: event({ id, author: host, hosts: [host], kind: { booking: { booking_id: id } }, when: { once: { start_ms: utc(start), end_ms: utc(start) + 1_800_000n } } }),
});

describe('a team booking page', () => {
  it('offers a round-robin time while any host is free, naming who is', () => {
    const offered: TeamSlots = teamSlots(engine, ask(RR), source);
    expect(has(offered.slots, NINE)).toBe(true);
    expect(freeAt(offered, NINE)).toEqual(['bo']);
    expect(freeAt(offered, TEN)).toEqual(['ana', 'bo']);
  });

  it('offers a collective only the times every host has free', () => {
    const offered: TeamSlots = teamSlots(engine, ask(COLLECTIVE), source);
    expect(has(offered.slots, NINE)).toBe(false);
    expect(has(offered.slots, TEN)).toBe(true);
  });

  it('offers nothing while one collective host has no schedule', () => {
    const none: HostSource = (host: string) => ({ ...source(host), availability: host === 'bo' ? null : WORKING_HOURS });
    expect(teamSlots(engine, ask(COLLECTIVE), none).slots).toEqual([]);
  });

  it("counts each host's confirmed bookings in the month the time falls in", () => {
    const entries: CalendarEntry[] = [booked('a1', 'ana', '2024-07-02T14:00:00Z'), booked('a2', 'ana', '2024-07-30T14:00:00Z'), booked('a3', 'ana', '2024-08-01T14:00:00Z'), booked('b1', 'bo', '2024-07-10T14:00:00Z')];
    expect(confirmedCounts(entries, ['ana', 'bo'], utc('2024-07-01T04:00:00Z'), utc('2024-08-01T04:00:00Z'))).toEqual([{ host: 'ana', confirmed: 2 }, { host: 'bo', confirmed: 1 }]);
  });

  it('gives an equal round robin to the host with fewer bookings that month, not the first by name', () => {
    const entries: CalendarEntry[] = [booked('a1', 'ana', '2024-07-02T14:00:00Z'), booked('a2', 'ana', '2024-07-09T14:00:00Z'), booked('b1', 'bo', '2024-06-10T14:00:00Z'), booked('b2', 'bo', '2024-06-11T14:00:00Z'), booked('b3', 'bo', '2024-06-12T14:00:00Z')];
    expect(rankedFor(engine, RR, TEN, ['ana', 'bo'], entries)).toEqual(['bo', 'ana']);
    expect(rankedFor(engine, RR, TEN, ['ana', 'bo'], [])).toEqual(['ana', 'bo']);
    expect(rankedFor(engine, RR, NINE, ['bo'], entries)).toEqual(['bo']);
  });

  it("counts over the core's Equal period: the month in the type's locked zone, or in UTC, whoever books", () => {
    // 23:30 on 31 July in New York is 1 August in UTC: July's in a New York-locked type, August's otherwise.
    const late: CalendarEntry[] = [booked('a1', 'ana', '2024-08-01T03:30:00Z')];
    expect(rankedFor(engine, RR, TEN, ['ana', 'bo'], late)).toEqual(['ana', 'bo']);
    expect(rankedFor(engine, { ...RR, zone_lock: NY }, TEN, ['ana', 'bo'], late)).toEqual(['bo', 'ana']);
    expect(engine.equalPeriod(null, TEN.start_ms)).toEqual({ start_ms: utc('2024-07-01T00:00:00Z'), end_ms: utc('2024-08-01T00:00:00Z') });
  });
});
