/**
 * Team bookings between members' instances (design §3.6.2, §3.6.3), over the real gate, iHTTP
 * router and core: a round robin moves past a host nobody answers for and leaves the first a
 * request when nobody answers; a collective is all or nothing, a late 409 cancelling the host who
 * already confirmed with `collective_incomplete`; a group slot takes bookings until its seats run out.
 */
import { describe, expect, it } from 'vitest';
import { bookingOf, BOOKING_ACK_PREFIX, BOOKING_PREFIX, type BookerDeps } from '../booking';
import { saveAvailability, saveEventType } from '../booking-pages';
import type { Booking } from '../generated/Booking';
import type { EventType } from '../generated/EventType';
import { bookCollective, bookRoundRobin, COLLECTIVE_INCOMPLETE } from '../team-booking';
import { saveTeamType } from '../team-types';
import { INTRO, WORKING_HOURS } from './booking-fixture';
import { choice, engine, member, NOW, SLOT, type Member } from './booking-rig';
import { event } from './event-fixture';
import { IhttpRelay } from './ihttp-relay';
import type { BookOutcome } from '@/lib/calendar/booking-form';
import type { Event } from '../generated/Event';

const team = (kind: EventType['kind']): EventType => ({ ...INTRO, id: 'team', name: 'Demo', kind, questions: [] });
const ROUND_ROBIN: EventType = team({ round_robin: { hosts: ['ana', 'bo'], strategy: 'equal' } });
const COLLECTIVE: EventType = team({ collective: { hosts: ['ana', 'bo'] } });
const GROUP: EventType = { ...INTRO, id: 'workshop', name: 'Workshop', kind: { group: { seats: 2 } }, questions: [] };

const deps = (m: Member): BookerDeps => ({ ports: m.ports, engine, client: m.endpoint.client, node: 'n1', me: m.name, title: 'Demo', nowMs: NOW });
const teamBooking = (type: EventType, by: string, id: string): Booking =>
  bookingOf({ ...choice, type, answers: [] }, { id, node: 'n1', host: '', me: by });

async function rig(online: readonly string[], type: EventType): Promise<{ relay: IhttpRelay; shared: Map<string, Uint8Array>; members: Map<string, Member> }> {
  const relay: IhttpRelay = new IhttpRelay();
  const shared: Map<string, Uint8Array> = new Map();
  const members: Map<string, Member> = new Map();
  for (const name of ['ana', 'bo', 'cy', 'di']) members.set(name, await member(name, relay, shared));
  const ana: Member = members.get('ana') as Member;
  if ('group' in (type.kind as object)) await saveEventType(ana.ports, engine, 'n1', 'ana', type);
  else await saveTeamType(ana.ports, engine, 'n1', type);
  for (const host of ['ana', 'bo']) await saveAvailability((members.get(host) as Member).ports, engine, 'n1', host, WORKING_HOURS);
  for (const host of ['ana', 'bo']) {
    if (online.includes(host)) continue;
    (members.get(host) as Member).endpoint.close();
    relay.offline(host);
  }
  return { relay, shared, members };
}

const ack = (shared: Map<string, Uint8Array>, host: string, id: string): Booking | null => {
  const bytes: Uint8Array | undefined = shared.get(`authored:n1:${host}|${BOOKING_ACK_PREFIX}${id}`);
  return bytes === undefined ? null : engine.decodeBooking(bytes);
};

describe('team bookings', () => {
  it('round robin moves past a host no instance answers for, to the next ranked host', async () => {
    const { shared, members } = await rig(['bo'], ROUND_ROBIN);
    const outcome: BookOutcome = await bookRoundRobin(deps(members.get('cy') as Member), teamBooking(ROUND_ROBIN, 'cy', 'r1'), ['ana', 'bo']);
    expect(outcome).toMatchObject({ kind: 'confirmed', booking: { host: 'bo' } });
    expect(ack(shared, 'bo', 'r1')?.state).toBe('confirmed');
    expect(ack(shared, 'ana', 'r1')).toBeNull();
  });

  it('round robin with nobody online leaves the first ranked host a request', async () => {
    const { shared, members } = await rig([], ROUND_ROBIN);
    const outcome: BookOutcome = await bookRoundRobin(deps(members.get('cy') as Member), teamBooking(ROUND_ROBIN, 'cy', 'r2'), ['bo', 'ana']);
    expect(outcome).toMatchObject({ kind: 'requested', booking: { host: 'bo' } });
    expect(shared.has(`authored:n1:cy|${BOOKING_PREFIX}r2`)).toBe(true);
  });

  it('a collective is booked with every host when all confirm, and the booker keeps one copy naming them all', async () => {
    const { shared, members } = await rig(['ana', 'bo'], COLLECTIVE);
    const outcome: BookOutcome = await bookCollective(deps(members.get('cy') as Member), teamBooking(COLLECTIVE, 'cy', 'c1'), ['ana', 'bo']);
    expect(outcome.kind).toBe('confirmed');
    expect([ack(shared, 'ana', 'c1')?.state, ack(shared, 'bo', 'c1')?.state]).toEqual(['confirmed', 'confirmed']);
    const copy: Uint8Array | undefined = shared.get('user:cy|cal/private/c1');
    expect(copy === undefined ? null : engine.decodeEvent(copy).hosts).toEqual(['ana', 'bo']);
  });

  it('a late 409 rolls the collective back: the host who confirmed is cancelled, and the booker is shown other times', async () => {
    const { shared, members } = await rig(['ana', 'bo'], COLLECTIVE);
    const busy: Event = event({ id: 'x', author: 'bo', hosts: ['bo'], when: { once: SLOT } });
    shared.set('authored:n1:bo|cal/event/x', engine.encodeEvent(busy));
    const outcome: BookOutcome = await bookCollective(deps(members.get('cy') as Member), teamBooking(COLLECTIVE, 'cy', 'c2'), ['ana', 'bo']);
    expect(outcome.kind).toBe('taken');
    expect(outcome.kind === 'taken' && outcome.alternatives.length).toBeGreaterThan(0);
    expect(ack(shared, 'ana', 'c2')?.state).toEqual({ cancelled: { by: 'cy', reason: COLLECTIVE_INCOMPLETE } });
    expect(ack(shared, 'bo', 'c2')).toBeNull();
    expect(shared.has('user:cy|cal/private/c2')).toBe(false);
  });

  it("a group slot takes bookings until its seats are gone, then offers other times", async () => {
    const { members } = await rig(['ana', 'bo'], GROUP);
    const groupBooking = (by: string, id: string): Booking => bookingOf({ ...choice, type: GROUP, answers: [] }, { id, node: 'n1', host: 'ana', me: by });
    const outcomes: BookOutcome['kind'][] = [];
    for (const [by, id] of [['bo', 'g1'], ['cy', 'g2'], ['di', 'g3']] as const) {
      outcomes.push((await bookRoundRobin(deps(members.get(by) as Member), groupBooking(by, id), ['ana'])).kind);
    }
    expect(outcomes).toEqual(['confirmed', 'confirmed', 'taken']);
  });
});
