/**
 * Every glue export the booking, propagation, ICS and storage paths use, through the real engine:
 * a method the facade names but the glue does not export fails here, not in a view.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CalendarEngine } from '../engine/calendar-engine';
import type { Availability } from '../generated/Availability';
import type { Booking } from '../generated/Booking';
import type { BookingRules } from '../generated/BookingRules';
import type { EventType } from '../generated/EventType';
import type { Interval } from '../generated/Interval';
import type { Projection } from '../generated/Projection';
import type { SlotRequest } from '../generated/SlotRequest';
import type { Write } from '../generated/Write';
import { event, NY, realEngine, utc } from './engine-rig';
import type { Imported } from '@/lib/calendar/generated/Imported';
import type { IcsFile } from '@/lib/calendar/generated/IcsFile';
import type { Event } from '../generated/Event';

let engine: CalendarEngine;
beforeAll(() => {
  engine = realEngine();
});

const nineToTen: { start_min: number; end_min: number }[] = [{ start_min: 9 * 60, end_min: 10 * 60 }];
const availability: Availability = { id: 'a1', name: 'Work', zone: NY, weekly: [nineToTen, nineToTen, nineToTen, nineToTen, nineToTen, [], []], overrides: [] };
const rules: BookingRules = { buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 0, max_per_day: null, increment_min: 30, range: 'indefinite', cancel_policy: null };
const span = (from: string, to: string): Interval => ({ start_ms: utc(from), end_ms: utc(to) });
const request = (busy: Interval[]): SlotRequest => ({
  availability, rules, duration_min: 30, busy, booked: [], now_ms: utc('2024-07-14T00:00:00Z'),
  from: { y: 2024, m: 7, d: 15 }, to: { y: 2024, m: 7, d: 15 },
});

describe('booking through the engine', () => {
  it('offers the free slots of a day in the availability zone, and only those', () => {
    const busy: Interval[] = [span('2024-07-15T13:00:00Z', '2024-07-15T13:30:00Z')];
    expect(engine.freeSlots(request([]))).toEqual([span('2024-07-15T13:00:00Z', '2024-07-15T13:30:00Z'), span('2024-07-15T13:30:00Z', '2024-07-15T14:00:00Z')]);
    expect(engine.freeSlots(request(busy))).toEqual([span('2024-07-15T13:30:00Z', '2024-07-15T14:00:00Z')]);
    expect(engine.offers(request(busy), span('2024-07-15T13:30:00Z', '2024-07-15T14:00:00Z'))).toBe(true);
    expect(engine.offers(request(busy), span('2024-07-15T13:00:00Z', '2024-07-15T13:30:00Z'))).toBe(false);
  });

  it('ranks free hosts and intersects a collective', () => {
    expect(engine.rankHosts('equal', ['bob', 'alice', 'carol'], ['alice', 'bob'], [{ host: 'alice', confirmed: 2 }])).toEqual(['bob', 'alice']);
    const shared: Interval = span('2024-07-15T13:30:00Z', '2024-07-15T14:00:00Z');
    expect(engine.collectiveSlots([[span('2024-07-15T13:00:00Z', '2024-07-15T13:30:00Z'), shared], [shared]])).toEqual([shared]);
    expect(engine.collectiveSlots([])).toEqual([]);
  });
});

describe('propagation through the engine', () => {
  it('plans one projection per descendant, with the allow-listed fields only', () => {
    const plan: Write[] = engine.fanOutPlan(event({ body: 'secret', propagate: { down: true, up_to: null } }), ['n2', 'n3']);
    expect(plan).toHaveLength(2);
    for (const write of plan) {
      if (!('put' in write)) throw new Error('a delete in a down plan');
      expect(write.put.projection.title).toBe('Standup');
      expect(Object.keys(write.put.projection).sort()).toEqual(['hosts', 'location', 'origin_node', 'origin_rev', 'title', 'when', 'zone']);
    }
  });

  it('pulls up to the named ancestor, caps the pull, and reconciles by what the reader can read', () => {
    const fromBelow: Event = event({ origin_node: 'n3', propagate: { down: false, up_to: 'n1' } });
    expect(engine.shownUpAt(fromBelow, ['n1'])).toBe(true);
    expect(engine.shownUpAt(fromBelow, ['n3', 'n1'])).toBe(false);
    const many: string[] = Array.from({ length: 300 }, (_: unknown, i: number): string => `n${i}`);
    expect(engine.upPullTargets(many)).toEqual({ targets: many.slice(0, 256), truncated: true });
    const projection: Projection = engine.decodeProjection(engine.encodeProjection({
      title: 'Standup', when: event({}).when, zone: NY, location: 'in_app', hosts: ['alice'], origin_node: 'n1', origin_rev: 1,
    }));
    expect(engine.reconcile(projection, 'unreadable')).toBe('show_without_link');
    expect(engine.reconcile(projection, 'gone')).toBe('hide');
    expect(engine.reconcile(projection, { found: { event: event({ propagate: { down: true, up_to: null } }) } })).toBe('show');
    expect(engine.reconcile(projection, { found: { event: event({ rev: 2, propagate: { down: true, up_to: null } }) } })).toBe('stale');
  });
});

describe('ICS and stored values through the engine', () => {
  it('exports an event and imports it back as a draft', () => {
    const file: IcsFile = engine.exportIcs([event({})]);
    expect(file.unwritten).toEqual([]);
    expect(file.text).toContain('SUMMARY:Standup');
    const imported: Imported = engine.importIcs(file.text, NY);
    expect(imported.skipped).toEqual([]);
    expect(imported.drafts.map((d: { title: string }): string => d.title)).toEqual(['Standup']);
  });

  it('round-trips availability, event types and bookings through their stored bytes', () => {
    expect(engine.decodeAvailability(engine.encodeAvailability(availability))).toEqual(availability);
    const type: EventType = { id: 't1', name: 'Intro', kind: 'one_on_one', durations_min: [30], rules, questions: [], color: 'primary', locked: false, zone_lock: null };
    expect(engine.decodeEventType(engine.encodeEventType(type))).toEqual(type);
    const booking: Booking = {
      id: 'b1', page: { member: { username: 'alice', slug: 'intro' } }, type_id: 't1', host: 'alice', booker: { member: { username: 'bob' } },
      start_ms: utc('2024-07-15T13:30:00Z'), end_ms: utc('2024-07-15T14:00:00Z'), zone: NY, answers: [], state: 'confirmed',
    };
    expect(engine.decodeBooking(engine.encodeBooking(booking))).toEqual(booking);
  });
});
