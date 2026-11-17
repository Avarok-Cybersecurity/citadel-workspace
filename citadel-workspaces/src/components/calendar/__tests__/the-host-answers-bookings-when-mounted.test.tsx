/**
 * The host's side of booking as the tab mounts it (design §3.6.1 steps 3-4): a request a member
 * left while the host was away is answered when the host's Calendar next mounts; and while it is
 * mounted, a member booking the host is confirmed live and keeps their own copy. The host's install
 * holds no `notifications` here, so the live booking also shows that a refused notification does
 * not fail a booking already made. The booker's Calendar takes the host's answers to its requests,
 * when it mounts and when an answer is written while it is mounted. A booking is cancelled from its event, by its booker (with the
 * host, then their own copy) or by its host, and the host records who cancelled.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { INTRO, WORKING_HOURS } from '@/lib/calendar/__tests__/booking-fixture';
import { realEngine, utc } from '@/lib/calendar/__tests__/engine-rig';
import { IhttpRelay } from '@/lib/calendar/__tests__/ihttp-relay';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { BOOKING_ACK_PREFIX, BOOKING_PREFIX, bookingOf } from '@/lib/calendar/booking';
import { BookingHost } from '@/lib/calendar/booking-host';
import type { Booking } from '@/lib/calendar/generated/Booking';
import { calendarPorts } from '@/lib/calendar/ports';
import { formatDayLong } from '@/lib/calendar/format';
import type { KvBackend } from '@/lib/citadel-apps/sdk/generated/KvBackend';
import { encodeSettings, SETTINGS_KEY } from '@/lib/calendar/zones';
import { mountCalendar, mountRig } from './mount-rig';
import type { ClaimVerdict } from '@/lib/calendar/booking-claim';
import type { MountRig } from '@/components/calendar/__tests__/mount-rig';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type * as CalendarGlue from '../../../../vendor/calendar/calendar_glue.js';
import type { Event } from '@/lib/calendar/generated/Event';

vi.mock('@/lib/calendar/engine/load-calendar-wasm', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const glue: typeof CalendarGlue = await import('../../../../vendor/calendar/calendar_glue.js');
  return {
    loadCalendarWasm: async (): Promise<typeof CalendarGlue> => {
      glue.initSync({ module: readFileSync(join(process.cwd(), 'public/calendar/calendar_glue_bg.wasm')) });
      return glue;
    },
  };
});

const engine: CalendarEngine = realEngine();
const IHTTP: Capability[] = ['ihttp.serve', 'ihttp.call'];
const authored = (author: string): KvBackend => ({ node_authored: { node_id: 'n1', author } });

function anaOffersIntro(shared: Map<string, Uint8Array>): void {
  const ana: MemoryStore = new MemoryStore('ana', shared);
  ana.put(authored('ana'), 'cal/type/t1', engine.encodeEventType(INTRO));
  ana.put(authored('ana'), 'cal/availability', engine.encodeAvailability(WORKING_HOURS));
}

function signedIn(me: string, shared: Map<string, Uint8Array>, relay: IhttpRelay): void {
  const store: MemoryStore = new MemoryStore(me, shared);
  store.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
  mountCalendar(mountRig(me, store, { ihttp: relay.port(me), held: IHTTP }).glue, me, false);
}

beforeEach((): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-07-16T15:00:00Z'));
  window.history.replaceState(null, '', '/workspace?nodeId=n1');
});
afterEach((): void => { vi.useRealTimers(); });

describe("the host's Calendar", () => {
  it('answers a request left while the host was away, when it next mounts', async () => {
    const shared: Map<string, Uint8Array> = new Map();
    anaOffersIntro(shared);
    const slot: { start_ms: bigint; end_ms: bigint; } = { start_ms: utc('2024-07-17T13:00:00Z'), end_ms: utc('2024-07-17T13:30:00Z') };
    const request: Booking = bookingOf({ type: INTRO, durationMin: 30, slot, zone: 'America/New_York', answers: [{ question_id: 'q-topic', value: 'Roadmap' }] }, { id: 'r1', node: 'n1', host: 'ana', me: 'bob' });
    new MemoryStore('bob', shared).put(authored('bob'), `${BOOKING_PREFIX}r1`, engine.encodeBooking(request));
    signedIn('ana', shared, new IhttpRelay());
    await waitFor(() => expect(shared.has(`authored:n1:ana|${BOOKING_ACK_PREFIX}r1`)).toBe(true));
    const ack: Uint8Array = shared.get(`authored:n1:ana|${BOOKING_ACK_PREFIX}r1`) as Uint8Array;
    expect(engine.decodeBooking(ack).state).toBe('confirmed');
    expect(engine.decodeEvent(shared.get('authored:n1:ana|cal/event/r1') as Uint8Array).visibility).toBe('busy_only');
  });

  it("takes the host's answers to the booker's requests: one given before it mounted, one while it is mounted", async () => {
    const shared: Map<string, Uint8Array> = new Map();
    anaOffersIntro(shared);
    const ana: MemoryStore = new MemoryStore('ana', shared);
    const bob: MemoryStore = new MemoryStore('bob', shared);
    const hour = (n: number): { start_ms: bigint; end_ms: bigint; } => ({ start_ms: utc('2024-07-17T13:00:00Z') + BigInt(n * 3_600_000), end_ms: utc('2024-07-17T13:30:00Z') + BigInt(n * 3_600_000) });
    const request = (id: string, n: number): Booking => bookingOf({ type: INTRO, durationMin: 30, slot: hour(n), zone: 'America/New_York', answers: [] }, { id, node: 'n1', host: 'ana', me: 'bob' });
    const answer = (id: string, n: number): void => ana.put(authored('ana'), `${BOOKING_ACK_PREFIX}${id}`, engine.encodeBooking({ ...request(id, n), state: 'confirmed' }));
    for (const [id, n] of [['r1', 0], ['r2', 1]] as const) bob.put(authored('bob'), `${BOOKING_PREFIX}${id}`, engine.encodeBooking(request(id, n)));
    answer('r1', 0);
    bob.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
    const rig: MountRig = mountRig('bob', bob, { ihttp: new IhttpRelay().port('bob'), held: IHTTP });
    mountCalendar(rig.glue, 'bob', false);
    await waitFor(() => expect(shared.has('user:bob|cal/private/r1')).toBe(true));
    expect(shared.has(`authored:n1:bob|${BOOKING_PREFIX}r1`)).toBe(false);
    answer('r2', 1);
    expect(shared.has('user:bob|cal/private/r2')).toBe(false);
    rig.change({ backend: { node_authored: { node_id: 'n1', author: 'ana' } }, key: `${BOOKING_ACK_PREFIX}r2` });
    await waitFor(() => expect(shared.has('user:bob|cal/private/r2')).toBe(true));
  });

  it('confirms a member booking it live, and the booker keeps their own copy', async () => {
    const shared: Map<string, Uint8Array> = new Map();
    const relay: IhttpRelay = new IhttpRelay();
    anaOffersIntro(shared);
    signedIn('ana', shared, relay);
    await screen.findByTestId('calendar-tab');
    const bob: MemoryStore = new MemoryStore('bob', shared);
    bob.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
    window.history.replaceState(null, '', '/workspace?nodeId=n1&tab=app%3Anet.avarok.calendar&book=ana');
    mountCalendar(mountRig('bob', bob, { ihttp: relay.port('bob'), held: IHTTP }).glue, 'bob', false);
    const page: ReturnType<typeof within> = within(await screen.findByTestId('calendar-booking-page'));
    const day: RegExp = new RegExp(`^${formatDayLong({ y: 2024, m: 7, d: 17 })},`);
    fireEvent.click(page.getByRole('button', { name: day }));
    fireEvent.click(page.getAllByTestId('calendar-slot')[0] as HTMLElement);
    fireEvent.change(page.getByLabelText(/What should we cover\?/), { target: { value: 'Roadmap' } });
    await act(async () => { fireEvent.click(page.getByTestId('calendar-confirm-booking')); });
    await waitFor(() => expect(page.getByTestId('calendar-booking-said')).toHaveTextContent(/^Booked: Intro call with ana/));
    expect([...shared.keys()].filter((k) => k.startsWith('user:bob|cal/private/'))).toHaveLength(1);
    expect([...shared.keys()].filter((k) => k.startsWith(`authored:n1:ana|${BOOKING_ACK_PREFIX}`))).toHaveLength(1);
  });

  it("moves a booking from its event: the booker picks a new time on the host's page, and the old one is cancelled", async () => {
    const shared: Map<string, Uint8Array> = new Map();
    const relay: IhttpRelay = new IhttpRelay();
    anaOffersIntro(shared);
    signedIn('ana', shared, relay);
    await screen.findByTestId('calendar-tab');
    const slot: { start_ms: bigint; end_ms: bigint; } = { start_ms: utc('2024-07-17T13:00:00Z'), end_ms: utc('2024-07-17T13:30:00Z') };
    const made: Booking = bookingOf({ type: INTRO, durationMin: 30, slot, zone: 'America/New_York', answers: [{ question_id: 'q-topic', value: 'x' }] }, { id: 'm1', node: 'n1', host: 'ana', me: 'bob' });
    const anaHost: BookingHost = new BookingHost({ ports: calendarPorts(mountRig('ana', new MemoryStore('ana', shared)).glue), engine, node: 'n1', me: 'ana', nowMs: (): bigint => utc('2024-07-16T15:00:00Z') });
    const verdict: ClaimVerdict = await anaHost.decide(made, 'bob', null);
    if (verdict.kind !== 'confirm') throw new Error('the fixture booking should be free');
    const ana: MemoryStore = new MemoryStore('ana', shared);
    ana.put(authored('ana'), 'cal/event/m1', engine.encodeEvent(verdict.event));
    ana.put(authored('ana'), `${BOOKING_ACK_PREFIX}m1`, engine.encodeBooking(verdict.booking));
    const bob: MemoryStore = new MemoryStore('bob', shared);
    bob.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
    bob.put('user', 'cal/private/m1', engine.encodeEvent({ ...verdict.event, author: 'bob', hosts: ['ana'], visibility: 'private', title: 'Intro call with ana' }));
    mountCalendar(mountRig('bob', bob, { ihttp: relay.port('bob'), held: IHTTP }).glue, 'bob', false);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Intro call with ana/ }))[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Reschedule' }));
    const page: ReturnType<typeof within> = within(await screen.findByTestId('calendar-booking-page'));
    fireEvent.click(page.getByRole('button', { name: new RegExp(`^${formatDayLong({ y: 2024, m: 7, d: 18 })},`) }));
    fireEvent.click(page.getAllByTestId('calendar-slot')[0] as HTMLElement);
    fireEvent.change(page.getByLabelText(/What should we cover\?/), { target: { value: 'Roadmap' } });
    await act(async () => { fireEvent.click(page.getByTestId('calendar-confirm-booking')); });
    await waitFor(() => expect(page.getByTestId('calendar-booking-said')).toHaveTextContent(/^Booked: Intro call with ana/));
    expect(engine.decodeBooking(shared.get(`authored:n1:ana|${BOOKING_ACK_PREFIX}m1`) as Uint8Array).state).toEqual({ cancelled: { by: 'bob', reason: 'rescheduled' } });
    const copies: string[] = [...shared.keys()].filter((k) => k.startsWith('user:bob|cal/private/'));
    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toBe('user:bob|cal/private/m1');
  });

  it('cancels a booking from its event: the booker with the host, and the host on their own', async () => {
    const shared: Map<string, Uint8Array> = new Map();
    const relay: IhttpRelay = new IhttpRelay();
    anaOffersIntro(shared);
    signedIn('ana', shared, relay);
    await screen.findByTestId('calendar-tab');
    const slot: { start_ms: bigint; end_ms: bigint; } = { start_ms: utc('2024-07-17T13:00:00Z'), end_ms: utc('2024-07-17T13:30:00Z') };
    const hourLater = (n: number): bigint => BigInt(n * 3_600_000);
    const made = (id: string, hours: number): Booking => bookingOf(
      { type: INTRO, durationMin: 30, slot: { start_ms: slot.start_ms + hourLater(hours), end_ms: slot.end_ms + hourLater(hours) }, zone: 'America/New_York', answers: [{ question_id: 'q-topic', value: 'x' }] },
      { id, node: 'n1', host: 'ana', me: 'bob' },
    );
    const anaHost: BookingHost = new BookingHost({ ports: calendarPorts(mountRig('ana', new MemoryStore('ana', shared)).glue), engine, node: 'n1', me: 'ana', nowMs: (): bigint => utc('2024-07-16T15:00:00Z') });
    for (const [id, hours] of [['k1', 0], ['k2', 1]] as const) {
      const verdict: ClaimVerdict = await anaHost.decide(made(id, hours), 'bob', null);
      if (verdict.kind !== 'confirm') throw new Error(`the fixture booking ${id} should be free`);
      const ana: MemoryStore = new MemoryStore('ana', shared);
      ana.put(authored('ana'), `cal/event/${id}`, engine.encodeEvent(verdict.event));
      ana.put(authored('ana'), `${BOOKING_ACK_PREFIX}${id}`, engine.encodeBooking(verdict.booking));
    }
    const bob: MemoryStore = new MemoryStore('bob', shared);
    bob.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
    const own: Event = engine.decodeEvent(shared.get('authored:n1:ana|cal/event/k1') as Uint8Array);
    bob.put('user', 'cal/private/k1', engine.encodeEvent({ ...own, author: 'bob', hosts: ['ana'], visibility: 'private', title: 'Intro call with ana' }));
    mountCalendar(mountRig('bob', bob, { ihttp: relay.port('bob'), held: IHTTP }).glue, 'bob', false);
    const chips: HTMLElement[] = await screen.findAllByRole('button', { name: /^Intro call with ana/ });
    fireEvent.click(chips[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'clash' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' })); });
    await screen.findByText('The booking is cancelled.');
    expect(engine.decodeEvent(shared.get('authored:n1:ana|cal/event/k1') as Uint8Array).status).toEqual({ cancelled: { by: 'bob', reason: 'clash' } });
    expect(engine.decodeEvent(shared.get('user:bob|cal/private/k1') as Uint8Array).status).toEqual({ cancelled: { by: 'bob', reason: 'clash' } });
    expect((await anaHost.cancelAsHost('k2', null)).status).toBe(200);
    expect(engine.decodeBooking(shared.get(`authored:n1:ana|${BOOKING_ACK_PREFIX}k2`) as Uint8Array).state).toEqual({ cancelled: { by: 'ana', reason: null } });
  });
});
