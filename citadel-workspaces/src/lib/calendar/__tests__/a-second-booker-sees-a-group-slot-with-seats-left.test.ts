/**
 * A group slot with seats left stays on the next booker's page (design §3.6.3): the page applies
 * the host's own seats rule (group-seats.ts `sharedSeats`), so it lists the time the host's
 * instance would confirm, drops it once the last seat is taken, and never offers a different
 * time that overlaps the seated booking.
 */
import { describe, expect, it } from 'vitest';
import { bookingOf, type BookerDeps } from '../booking';
import { busyOf, readBookingPage, saveAvailability, saveEventType } from '../booking-pages';
import type { EventType } from '../generated/EventType';
import type { Interval } from '../generated/Interval';
import { bookerSlots, readAcks } from '../group-seats';
import { readSource } from '../read-sources';
import { bookRoundRobin } from '../team-booking';
import { INTRO, WORKING_HOURS } from './booking-fixture';
import { choice, engine, member, NOW, SLOT, type Member } from './booking-rig';
import { IhttpRelay } from './ihttp-relay';
import type { BookOutcome } from '@/lib/calendar/booking-form';

const GROUP: EventType = { ...INTRO, id: 'workshop', name: 'Workshop', kind: { group: { seats: 2 } }, questions: [] };
const DAY: { y: number; m: number; d: number; } = { y: 2024, m: 7, d: 16 };
const deps = (m: Member): BookerDeps => ({ ports: m.ports, engine, client: m.endpoint.client, node: 'n1', me: m.name, title: 'Workshop', nowMs: NOW });
const at = (s: Interval): string => `${new Date(Number(s.start_ms)).toISOString()}/${Number(s.end_ms - s.start_ms) / 60_000}`;

async function pageOf(viewer: Member, durationMin: number): Promise<string[]> {
  const [page, acks, read] = await Promise.all([readBookingPage(viewer.ports, engine, 'n1', 'ana'), readAcks(viewer.ports, engine, 'n1', 'ana'), readSource(viewer.ports, engine, 'authored', 'n1')]);
  const ask: { type: EventType; durationMin: number; nowMs: bigint; from: { y: number; m: number; d: number; }; to: { y: number; m: number; d: number; }; } = { type: GROUP, durationMin, nowMs: NOW, from: DAY, to: DAY };
  return bookerSlots(engine, ask, page.availability, (fromMs, toMs, zone, except) => busyOf(read.entries, 'ana', zone, { fromMs, toMs }, except, engine), acks).map(at);
}

describe("a group slot on the next booker's page", () => {
  it('is listed while a seat is left, as the host confirms, and gone once the seats are taken', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const [ana, bo, cy, di] = await Promise.all(['ana', 'bo', 'cy', 'di'].map((n: string) => member(n, relay, shared)));
    await saveEventType(ana.ports, engine, 'n1', 'ana', GROUP);
    await saveAvailability(ana.ports, engine, 'n1', 'ana', WORKING_HOURS);
    const book = (m: Member, id: string): Promise<BookOutcome> => bookRoundRobin(deps(m), bookingOf({ ...choice, type: GROUP, answers: [] }, { id, node: 'n1', host: 'ana', me: m.name }), ['ana']);
    const slot: string = at(SLOT);

    expect((await book(bo, 'g1')).kind).toBe('confirmed');
    expect(await pageOf(cy, 30)).toContain(slot);
    expect(await pageOf(cy, 60)).not.toContain('2024-07-16T13:00:00.000Z/60');
    expect((await book(cy, 'g2')).kind).toBe('confirmed');
    expect(await pageOf(di, 30)).not.toContain(slot);
  });
});
