/**
 * The booking protocol between members' instances (design §3.6.1), over the real glue gate and
 * iHTTP router, a fake relay and one shared store that answers on a later turn, as the kernel does: two bookers racing for one slot get one 201 and
 * one 409 with other times; a booking for someone other than its caller is refused; an offline host
 * is left a request, which their next instance answers and the booker then takes, told either way; a cancellation says who made it, and tells the host; and a
 * reschedule moves a booking to a new time, the old one cancelled and the booker's copy moved.
 */
import { describe, expect, it } from 'vitest';
import { book, bookingOf, BOOKING_ACK_PREFIX, BOOKING_PREFIX, cancelBooking } from '../booking';
import { takeAnswers } from '../booking-answers';
import { saveAvailability, saveEventType } from '../booking-pages';
import type { Booking } from '../generated/Booking';
import { INTRO, WORKING_HOURS } from './booking-fixture';
import { utc } from './engine-rig';
import { IhttpRelay } from './ihttp-relay';
import { choice, engine, member, NOW, SLOT, type Member } from './booking-rig';
import type { BookOutcome } from '@/lib/calendar/booking-form';

async function anaOpensBookings(ana: Member): Promise<void> {
  await saveEventType(ana.ports, engine, 'n1', 'ana', INTRO);
  await saveAvailability(ana.ports, engine, 'n1', 'ana', WORKING_HOURS);
}

const booking = (by: string, id: string): Booking => bookingOf(choice, { id, node: 'n1', host: 'ana', me: by });
const bookAs = (m: Member, b: Booking, replacing: string | null = null): Promise<BookOutcome> =>
  book({ ports: m.ports, engine, client: m.endpoint.client, node: 'n1', me: m.name, title: 'Intro call with ana', nowMs: NOW }, b, replacing);

describe('the booking protocol', () => {
  it('confirms one of two bookers racing for a slot, and offers the other other times', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const [ana, bob, cy] = (await Promise.all(['ana', 'bob', 'cy'].map((n) => member(n, relay, shared)))) as [Member, Member, Member];
    await anaOpensBookings(ana);
    const [first, second] = await Promise.all([bookAs(bob, booking('bob', 'b1')), bookAs(cy, booking('cy', 'c1'))]);
    expect([first.kind, second.kind].sort()).toEqual(['confirmed', 'taken']);
    const lost: BookOutcome = first.kind === 'taken' ? first : second;
    expect(lost.kind === 'taken' && lost.alternatives.length).toBeGreaterThan(0);
    expect(lost.kind === 'taken' && lost.alternatives.some((a) => a.start_ms === SLOT.start_ms)).toBe(false);
    expect(ana.notes).toHaveLength(1);
    const winner: string = first.kind === 'confirmed' ? 'bob' : 'cy';
    expect([...shared.keys()].filter((k) => k.includes('|cal/private/'))).toEqual([`user:${winner}|cal/private/${winner === 'bob' ? 'b1' : 'c1'}`]);
  });

  it('refuses a booking made out for someone other than its caller', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const [ana, bob] = (await Promise.all(['ana', 'bob'].map((n) => member(n, relay, shared)))) as [Member, Member];
    await anaOpensBookings(ana);
    const outcome: BookOutcome = await bookAs(bob, booking('cy', 'forged'));
    expect(outcome).toEqual({ kind: 'failed', reason: 'ana refused it: a booking may only be made for its caller' });
  });

  it('leaves an offline host a request, which their next instance answers', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const setup: Member = await member('ana', relay, shared);
    await anaOpensBookings(setup);
    setup.endpoint.close();
    relay.offline('ana');
    const bob: Member = await member('bob', relay, shared);
    const outcome: BookOutcome = await bookAs(bob, booking('bob', 'b2'));
    expect(outcome.kind).toBe('requested');
    const ana: Member = await member('ana', relay, shared);
    expect(await ana.host.answerRequests()).toBe(1);
    const ack: Uint8Array | undefined = shared.get(`authored:n1:ana|${BOOKING_ACK_PREFIX}b2`);
    expect(ack === undefined ? null : engine.decodeBooking(ack).state).toBe('confirmed');
    expect(await ana.host.answerRequests()).toBe(0);
  });

  it("gives the booker their copy and tells them once the host's next instance answers their request", async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const setup: Member = await member('ana', relay, shared);
    await anaOpensBookings(setup);
    setup.endpoint.close();
    relay.offline('ana');
    const bob: Member = await member('bob', relay, shared);
    await bookAs(bob, booking('bob', 'b2'));
    expect(await takeAnswers({ ports: bob.ports, engine, node: 'n1', me: 'bob', nowMs: NOW })).toBe(0);
    await (await member('ana', relay, shared)).host.answerRequests();
    expect(await takeAnswers({ ports: bob.ports, engine, node: 'n1', me: 'bob', nowMs: NOW })).toBe(1);
    const copy: Uint8Array | undefined = shared.get('user:bob|cal/private/b2');
    expect(copy === undefined ? null : engine.decodeEvent(copy)).toMatchObject({ title: 'Intro call with ana', hosts: ['ana'], visibility: 'private', when: { once: SLOT } });
    expect(bob.notes).toEqual(['Booking confirmed: Intro call with ana is booked.']);
    expect(shared.has(`authored:n1:bob|${BOOKING_PREFIX}b2`)).toBe(false);
    expect(await takeAnswers({ ports: bob.ports, engine, node: 'n1', me: 'bob', nowMs: NOW })).toBe(0);
  });

  it("takes no answer that names another booker, and tells the booker when the host could not take it", async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    await anaOpensBookings(await member('ana', relay, shared));
    relay.offline('ana');
    const bob: Member = await member('bob', relay, shared);
    await bookAs(bob, booking('bob', 'b4'));
    const ack: string = `authored:n1:ana|${BOOKING_ACK_PREFIX}b4`;
    shared.set(ack, engine.encodeBooking({ ...booking('cy', 'b4'), state: 'confirmed' }));
    expect(await takeAnswers({ ports: bob.ports, engine, node: 'n1', me: 'bob', nowMs: NOW })).toBe(0);
    shared.set(ack, engine.encodeBooking({ ...booking('bob', 'b4'), state: 'declined' }));
    expect(await takeAnswers({ ports: bob.ports, engine, node: 'n1', me: 'bob', nowMs: NOW })).toBe(1);
    expect([shared.has('user:bob|cal/private/b4'), bob.notes]).toEqual([false, ['Booking not made: Intro call with ana was not booked; pick another time.']]);
  });

  it('cancels a booking for its booker, saying who cancelled, and refuses anyone else', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const [ana, bob, cy] = (await Promise.all(['ana', 'bob', 'cy'].map((n) => member(n, relay, shared)))) as [Member, Member, Member];
    await anaOpensBookings(ana);
    expect((await bookAs(bob, booking('bob', 'b3'))).kind).toBe('confirmed');
    expect(await cancelBooking(cy.endpoint.client, 'ana', 'b3', 'not mine')).toEqual({ ok: false, reason: 'ana refused it: only its booker or host may cancel a booking' });
    expect(await cancelBooking(bob.endpoint.client, 'ana', 'b3', 'clash')).toEqual({ ok: true });
    const event: Uint8Array | undefined = shared.get('authored:n1:ana|cal/event/b3');
    expect(event === undefined ? null : engine.decodeEvent(event).status).toEqual({ cancelled: { by: 'bob', reason: 'clash' } });
    expect(ana.notes.at(-1)).toBe('Booking cancelled: bob cancelled: clash');
  });

  it('tells the host nothing of a cancellation they made themselves', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const [ana, bob] = (await Promise.all(['ana', 'bob'].map((n) => member(n, relay, shared)))) as [Member, Member];
    await anaOpensBookings(ana);
    expect((await bookAs(bob, booking('bob', 'b7'))).kind).toBe('confirmed');
    expect((await ana.host.cancelAsHost('b7', 'travelling')).status).toBe(200);
    expect(ana.notes.filter((n: string) => n.startsWith('Booking cancelled'))).toEqual([]);
  });

  it('moves a booking to a new time, cancelling the old one and moving the booker\'s copy', async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const [ana, bob] = (await Promise.all(['ana', 'bob'].map((n) => member(n, relay, shared)))) as [Member, Member];
    await anaOpensBookings(ana);
    expect((await bookAs(bob, booking('bob', 'b5'))).kind).toBe('confirmed');
    // An hour from the same start: it overlaps the old half hour, which the host must leave out.
    const later: Booking = { ...booking('bob', 'b6'), end_ms: utc('2024-07-16T14:00:00Z') };
    const moved: BookOutcome = await bookAs(bob, later, 'b5');
    expect(moved.kind === 'confirmed' && moved.booking.state).toEqual({ rescheduled: { from: 'b5' } });
    const old: Uint8Array | undefined = shared.get('authored:n1:ana|cal/event/b5');
    expect(old === undefined ? null : engine.decodeEvent(old).status).toEqual({ cancelled: { by: 'bob', reason: 'rescheduled' } });
    // A reschedule is a new booking, said as one, never also as a cancellation.
    expect(ana.notes.filter((n: string) => n.startsWith('Booking cancelled'))).toEqual([]);
    expect([...shared.keys()].filter((k) => k.startsWith('user:bob|cal/private/'))).toEqual(['user:bob|cal/private/b6']);
  });
});
