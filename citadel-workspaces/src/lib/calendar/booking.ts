/**
 * Booking a member (design §3.6.1), the booker's side: the booking the invitee's choice makes,
 * claimed live on the host's instance (`POST /book`, booking-host.ts), which answers 201 with the
 * confirmed booking or 409 with other times. When no instance of the host is online (the relay's
 * `no_host`, or any plane unavailable), the booking is left as a request in the booker's own
 * authored namespace on the node (`cal/booking/<id>`), which the host's next instance answers in
 * theirs (`cal/booking-ack/<id>`). A confirmed booking is kept in the booker's own calendar too.
 */
import { IhttpCancelled, type IhttpClient, type IhttpResponse } from '@/lib/citadel-apps/glue-sdk/ihttp-client';
import { CALENDAR_APP_ID } from './app-id';
import type { BookingChoice, BookOutcome } from './booking-form';
import { BOOK_PATH, cancelPath, decodeAlternatives, decodeReason, encodeCancel, reschedulePath } from './booking-wire';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Booking } from './generated/Booking';
import type { Event } from './generated/Event';
import { PortRefused, refusalCopy, type CalendarPorts } from './ports';
import { PRIVATE_PREFIX } from './read-sources';

export const BOOKING_PREFIX: string = 'cal/booking/';
export const BOOKING_ACK_PREFIX: string = 'cal/booking-ack/';

export interface BookingContext {
  readonly id: string;
  readonly node: string;
  readonly host: string;
  readonly me: string;
}

/** The booking a choice makes: on the host's page on this node (its slug is the node's id). */
export function bookingOf(choice: BookingChoice, ctx: BookingContext): Booking {
  return {
    id: ctx.id, page: { member: { username: ctx.host, slug: ctx.node } }, type_id: choice.type.id, host: ctx.host,
    booker: { member: { username: ctx.me } }, start_ms: choice.slot.start_ms, end_ms: choice.slot.end_ms,
    zone: choice.zone, answers: choice.answers, state: 'requested',
  };
}

export async function requestBooking(ports: CalendarPorts, engine: CalendarEngine, booking: Booking, node: string, me: string): Promise<BookOutcome> {
  try {
    await ports.storage.set({ kind: 'authored', node, author: me }, `${BOOKING_PREFIX}${booking.id}`, engine.encodeBooking(booking));
    return { kind: 'requested', booking };
  } catch (e: unknown) {
    if (e instanceof PortRefused) return { kind: 'failed', reason: refusalCopy(e.refused) };
    throw e;
  }
}

/** The host's answer to booking `id` (`cal/booking-ack/<id>` in the host's namespace), or null. */
export async function bookingAckOf(ports: CalendarPorts, engine: CalendarEngine, node: string, host: string, id: string): Promise<Booking | null> {
  const bytes: Uint8Array | null = await ports.storage.get({ kind: 'authored', node, author: host }, `${BOOKING_ACK_PREFIX}${id}`);
  return bytes === null ? null : engine.decodeBooking(bytes);
}

export interface BookerDeps {
  readonly ports: CalendarPorts;
  readonly engine: CalendarEngine;
  readonly client: IhttpClient;
  readonly node: string;
  readonly me: string;
  /** The booker's own copy's title: "Intro call with Ana". */
  readonly title: string;
  readonly nowMs: bigint;
}

const hostAddress = (host: string): { user: { app_id: "net.avarok.calendar"; username: string; }; } => ({ user: { app_id: CALENDAR_APP_ID, username: host } });

/** What the host answered when it was not a booking, in words. */
function answered(host: string, r: IhttpResponse): string {
  const reason: string | null = decodeReason(r.body);
  return reason === null ? `${host} answered ${r.status}` : `${host} refused it: ${reason}`;
}

/** The booker's own copy of a confirmed booking, private to them (design §3.6.1 step 4). */
export function ownCopy(booking: Booking, d: Pick<BookerDeps, 'node' | 'me' | 'title' | 'nowMs'>): Event {
  return {
    id: booking.id, rev: 1, origin_node: d.node, author: d.me, title: d.title, body: null, kind: { booking: { booking_id: booking.id } },
    status: 'confirmed', when: { once: { start_ms: booking.start_ms, end_ms: booking.end_ms } }, zone: booking.zone, location: 'in_app',
    hosts: [booking.host], invitees: [{ member: { username: d.me } }], visibility: 'private', propagate: { down: false, up_to: null },
    reminders: [], notes_doc: null, source: null, created_ms: d.nowMs, updated_ms: d.nowMs,
  };
}

/** What one host's instance answered a claim; `unreachable` when none answered at all. */
export type Claimed = BookOutcome | { readonly kind: 'unreachable'; readonly reason: string };

/**
 * Claims `booking` on its host alone, writing nothing of the booker's: the answer is the host's,
 * and the client takes none from anyone else (ihttp-client.ts). Team bookings claim through this,
 * one host at a time (team-booking.ts).
 */
export async function claimWith(d: Pick<BookerDeps, 'engine' | 'client'>, booking: Booking, replacing: string | null): Promise<Claimed> {
  let r: IhttpResponse;
  try {
    const path: string = replacing === null ? BOOK_PATH : reschedulePath(replacing);
    r = await d.client.request(hostAddress(booking.host), 'prefer_p2p_then_relay', 'POST', path, '', d.engine.encodeBooking(booking));
  } catch (e: unknown) {
    const unavailable: boolean = e instanceof PortRefused && typeof e.refused === 'object' && 'unavailable' in e.refused;
    if (e instanceof PortRefused) return { kind: unavailable ? 'unreachable' : 'failed', reason: refusalCopy(e.refused) };
    if (e instanceof IhttpCancelled) return { kind: 'failed', reason: `the booking was cut off (${e.reason})` };
    throw e;
  }
  if (r.status === 409) return { kind: 'taken', alternatives: decodeAlternatives(r.body) ?? [] };
  if (r.status !== 201) return { kind: 'failed', reason: answered(booking.host, r) };
  return { kind: 'confirmed', booking: d.engine.decodeBooking(r.body) };
}

/** Keeps a confirmed booking in the booker's own calendar; with `replacing`, drops the one it moved. */
export async function keepOwnCopy(d: Pick<BookerDeps, 'ports' | 'engine'>, own: Event, replacing: string | null): Promise<void> {
  await d.ports.storage.set({ kind: 'user' }, `${PRIVATE_PREFIX}${own.id}`, d.engine.encodeEvent(own));
  if (replacing !== null) await d.ports.storage.remove({ kind: 'user' }, `${PRIVATE_PREFIX}${replacing}`);
}

/**
 * Books `booking`; with `replacing`, moves that booking of the same host to this one instead. With
 * no instance of the host online a new booking is left as a request; a move is not.
 */
export async function book(d: BookerDeps, booking: Booking, replacing: string | null): Promise<BookOutcome> {
  const claimed: Claimed = await claimWith(d, booking, replacing);
  if (claimed.kind === 'unreachable') return replacing === null ? requestBooking(d.ports, d.engine, booking, d.node, d.me) : { kind: 'failed', reason: claimed.reason };
  if (claimed.kind === 'confirmed') await keepOwnCopy(d, ownCopy(claimed.booking, d), replacing);
  return claimed;
}

/** Cancels booking `id` with `host`, saying why; the host records who cancelled from the session. */
export async function cancelBooking(client: IhttpClient, host: string, id: string, reason: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const r: IhttpResponse = await client.request(hostAddress(host), 'prefer_p2p_then_relay', 'POST', cancelPath(id), '', encodeCancel(reason));
    return r.status === 200 ? { ok: true } : { ok: false, reason: answered(host, r) };
  } catch (e: unknown) {
    if (e instanceof PortRefused) return { ok: false, reason: refusalCopy(e.refused) };
    if (e instanceof IhttpCancelled) return { ok: false, reason: `the cancellation was cut off (${e.reason})` };
    throw e;
  }
}

/** What the reader is to a booking event: its host (their event) or its booker (their own copy). */
export type BookingRole = { readonly kind: 'host'; readonly id: string } | { readonly kind: 'booker'; readonly id: string; readonly host: string };

export function bookingRole(event: Event, me: string): BookingRole | null {
  if (typeof event.kind !== 'object' || event.status !== 'confirmed' || event.author !== me) return null;
  const id: string = event.kind.booking.booking_id;
  if (event.hosts.includes(me)) return { kind: 'host', id };
  const host: string | undefined = event.hosts[0];
  return event.visibility === 'private' && host !== undefined ? { kind: 'booker', id, host } : null;
}

/** The booker cancels with the host, then marks their own copy cancelled. */
export async function cancelAsBooker(d: Pick<BookerDeps, 'ports' | 'engine' | 'client' | 'me' | 'nowMs'>, own: Event, host: string, id: string, reason: string | null): Promise<string | null> {
  const done: { ok: true; } | { ok: false; reason: string; } = await cancelBooking(d.client, host, id, reason);
  if (!done.ok) return done.reason;
  const cancelled: Event = { ...own, status: { cancelled: { by: d.me, reason } }, rev: own.rev + 1, updated_ms: d.nowMs };
  await d.ports.storage.set({ kind: 'user' }, `${PRIVATE_PREFIX}${own.id}`, d.engine.encodeEvent(cancelled));
  return null;
}
