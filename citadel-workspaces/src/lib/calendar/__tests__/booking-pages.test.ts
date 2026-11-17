/**
 * A host's booking page on a node, through the real ports and gate: their types and schedule are
 * read from their authored namespace and nobody else's; and what they are busy with is derived
 * from the events read, their confirmed timed events and recurring occurrences, bookings counted
 * per day.
 */
import { describe, expect, it } from 'vitest';
import { busyOf, hostsOn, readBookingPage, saveAvailability, saveEventType } from '../booking-pages';
import { entryKey, type CalendarEntry } from '../store';
import { event, NY, realEngine, utc } from './engine-rig';
import { INTRO, WORKING_HOURS } from './booking-fixture';
import { portsRig } from './ports-rig';
import type { BookingPageData, HostBusy } from '@/lib/calendar/booking-pages';
import type { CalendarPorts } from '@/lib/calendar/ports';
import type { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const own = (e: ReturnType<typeof event>): CalendarEntry => ({ key: entryKey('authored', 'n1', e.author, `cal/event/${e.id}`), source: 'authored', event: e });

describe("a host's booking page", () => {
  it("reads the host's types and schedule, not another author's", async () => {
    const ana: { store: MemoryStore; ports: CalendarPorts; } = portsRig('ana');
    await saveEventType(ana.ports, engine, 'n1', 'ana', INTRO);
    await saveEventType(ana.ports, engine, 'n1', 'ana', { ...INTRO, id: 't2', name: 'Design review' });
    await saveAvailability(ana.ports, engine, 'n1', 'ana', WORKING_HOURS);
    const bob: { store: MemoryStore; ports: CalendarPorts; } = portsRig('bob');
    bob.store.values.clear();
    for (const [k, v] of ana.store.values) bob.store.values.set(k, v);
    await saveEventType(bob.ports, engine, 'n1', 'bob', { ...INTRO, name: "Bob's call" });
    const page: BookingPageData = await readBookingPage(bob.ports, engine, 'n1', 'ana');
    expect(page.types.map((t) => t.name)).toEqual(['Design review', 'Intro call']);
    expect(page.availability).toEqual(WORKING_HOURS);
    expect(page.unreadable).toBe(0);
    expect(await hostsOn(bob.ports, 'n1')).toEqual(['ana', 'bob']);
  });

  it('says nothing is bookable before a schedule is saved, and counts a type it cannot decode', async () => {
    const { store, ports } = portsRig('ana');
    store.put({ node_authored: { node_id: 'n1', author: 'ana' } }, 'cal/type/broken', new Uint8Array([0xff]));
    const page: BookingPageData = await readBookingPage(ports, engine, 'n1', 'ana');
    expect([page.availability, page.types, page.unreadable]).toEqual([null, [], 1]);
  });
});

describe('what a host is busy with', () => {
  const range: { fromMs: bigint; toMs: bigint; } = { fromMs: utc('2024-07-15T00:00:00Z'), toMs: utc('2024-07-22T00:00:00Z') };
  it('takes their confirmed timed events and recurring occurrences, counts bookings by day, and skips the rest', () => {
    const booking: CalendarEntry = own(event({ id: 'b1', author: 'ana', hosts: ['ana'], kind: { booking: { booking_id: 'k1' } } }));
    const hosted: CalendarEntry = own(event({ id: 'h1', author: 'cy', hosts: ['cy', 'ana'], when: { once: { start_ms: utc('2024-07-16T15:00:00Z'), end_ms: utc('2024-07-16T16:00:00Z') } } }));
    const cancelled: CalendarEntry = own(event({ id: 'x1', author: 'ana', status: { cancelled: { by: 'ana', reason: null } } }));
    const others: CalendarEntry = own(event({ id: 'o1', author: 'bob', hosts: ['bob'] }));
    const allDay: CalendarEntry = own(event({ id: 'd1', author: 'ana', when: { all_day: { date: { y: 2024, m: 7, d: 17 }, days: 1 } } }));
    const weekly: CalendarEntry = own(event({
      id: 'w1', author: 'ana',
      when: { recurring: { start: { date: { y: 2024, m: 7, d: 1 }, minute: 600 }, duration_min: 30, rule: { freq: 'weekly', interval: 1, by_day: [], by_month_day: [], count: null }, exdates: [], until_ms: null } },
    }));
    const got: HostBusy = busyOf([booking, hosted, cancelled, others, allDay, weekly], 'ana', NY, range, new Set(), engine);
    expect(got.busy.map((b) => new Date(Number(b.start_ms)).toISOString()).sort()).toEqual(['2024-07-15T13:00:00.000Z', '2024-07-15T14:00:00.000Z', '2024-07-16T15:00:00.000Z']);
    expect(got.booked).toEqual([{ date: { y: 2024, m: 7, d: 15 }, count: 1 }]);
  });
});
