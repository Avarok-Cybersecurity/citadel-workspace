/**
 * A seat is shared only in the very slot of the very type that was booked (design §3.6.3,
 * group-seats.ts): a group booking of another length, or of another type, at the same start makes
 * the host busy as any event does. So the host's instance refuses a second booking that differs
 * in length or type, and the next booker's page does not offer it, while the matching slot still
 * shares its seat. Either side treating "same start" as "same slot" would seat two meetings in one
 * hour.
 */
import { describe, expect, it } from 'vitest';
import { bookingOf, type BookerDeps } from '../booking';
import { busyOf, readBookingPage, saveAvailability, saveEventType } from '../booking-pages';
import type { EventType } from '../generated/EventType';
import type { Interval } from '../generated/Interval';
import { bookerSlots, readAcks, sharedSeats } from '../group-seats';
import { readSource } from '../read-sources';
import { bookRoundRobin } from '../team-booking';
import { INTRO, WORKING_HOURS } from './booking-fixture';
import { choice, engine, member, NOW, SLOT, type Member } from './booking-rig';
import { IhttpRelay } from './ihttp-relay';
import type { Booking } from '@/lib/calendar/generated/Booking';

const WORKSHOP: EventType = { ...INTRO, id: 'workshop', name: 'Workshop', kind: { group: { seats: 3 } }, durations_min: [30, 60], questions: [] };
const CLINIC: EventType = { ...WORKSHOP, id: 'clinic', name: 'Clinic' };
const DAY: { y: number; m: number; d: number; } = { y: 2024, m: 7, d: 16 };
const HOUR: Interval = { start_ms: SLOT.start_ms, end_ms: SLOT.start_ms + 3_600_000n };
const at = (s: Interval): string => `${new Date(Number(s.start_ms)).toISOString()}/${Number(s.end_ms - s.start_ms) / 60_000}`;

interface Rig {
  readonly book: (m: Member, id: string, type: EventType, slot: Interval) => Promise<unknown>;
  readonly pageOf: (viewer: Member, type: EventType, durationMin: number) => Promise<string[]>;
  readonly people: readonly [Member, Member, Member];
}

async function rig(): Promise<Rig> {
  const relay: IhttpRelay = new IhttpRelay();
  const shared: Map<string, Uint8Array> = new Map();
  const [ana, bo, cy] = await Promise.all(['ana', 'bo', 'cy'].map((n: string) => member(n, relay, shared))) as [Member, Member, Member];
  await saveEventType(ana.ports, engine, 'n1', 'ana', WORKSHOP);
  await saveEventType(ana.ports, engine, 'n1', 'ana', CLINIC);
  await saveAvailability(ana.ports, engine, 'n1', 'ana', WORKING_HOURS);
  const deps = (m: Member, title: string): BookerDeps => ({ ports: m.ports, engine, client: m.endpoint.client, node: 'n1', me: m.name, title, nowMs: NOW });
  const book = async (m: Member, id: string, type: EventType, slot: Interval): Promise<unknown> => {
    const durationMin: number = Number(slot.end_ms - slot.start_ms) / 60_000;
    const booking: Booking = bookingOf({ ...choice, type, durationMin, slot, answers: [] }, { id, node: 'n1', host: 'ana', me: m.name });
    return (await bookRoundRobin(deps(m, type.name), booking, ['ana'])).kind;
  };
  const pageOf = async (viewer: Member, type: EventType, durationMin: number): Promise<string[]> => {
    const [page, acks, read] = await Promise.all([readBookingPage(viewer.ports, engine, 'n1', 'ana'), readAcks(viewer.ports, engine, 'n1', 'ana'), readSource(viewer.ports, engine, 'authored', 'n1')]);
    const ask: { type: EventType; durationMin: number; nowMs: bigint; from: { y: number; m: number; d: number; }; to: { y: number; m: number; d: number; }; } = { type, durationMin, nowMs: NOW, from: DAY, to: DAY };
    return bookerSlots(engine, ask, page.availability, (f, t, zone, except) => busyOf(read.entries, 'ana', zone, { fromMs: f, toMs: t }, except, engine), acks).map(at);
  };
  return { book, pageOf, people: [ana, bo, cy] };
}

describe('a seated group slot', () => {
  it('keeps the host busy for the same start at another length: refused at claim, not offered on the page', async () => {
    const { book, pageOf, people: [ana, bo, cy] } = await rig();
    expect(await book(bo, 'g1', WORKSHOP, HOUR)).toBe('confirmed');
    expect(sharedSeats(WORKSHOP, { id: null, type_id: WORKSHOP.id, ...SLOT }, await readAcks(ana.ports, engine, 'n1', 'ana'), engine)).toEqual([]);

    expect(await pageOf(cy, WORKSHOP, 30)).not.toContain(at(SLOT));
    expect(await book(cy, 'g2', WORKSHOP, SLOT)).not.toBe('confirmed');
    expect(await pageOf(cy, WORKSHOP, 60)).toContain(at(HOUR));
    expect(await book(cy, 'g3', WORKSHOP, HOUR)).toBe('confirmed');
  });

  it('keeps the host busy for the same slot of another type: refused at claim, not offered on the page', async () => {
    const { book, pageOf, people: [ana, bo, cy] } = await rig();
    expect(await book(bo, 'g1', CLINIC, SLOT)).toBe('confirmed');
    expect(sharedSeats(WORKSHOP, { id: null, type_id: WORKSHOP.id, ...SLOT }, await readAcks(ana.ports, engine, 'n1', 'ana'), engine)).toEqual([]);

    expect(await pageOf(cy, WORKSHOP, 30)).not.toContain(at(SLOT));
    expect(await book(cy, 'g2', WORKSHOP, SLOT)).not.toBe('confirmed');
    expect(await pageOf(cy, CLINIC, 30)).toContain(at(SLOT));
    expect(await book(cy, 'g3', CLINIC, SLOT)).toBe('confirmed');
  });
});
