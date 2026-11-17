/**
 * The host's side of booking (design §3.6.1 steps 3-5), in the host's mounted instance: `/book`,
 * `/book/:id/cancel` and `/book/:id/reschedule`, and the requests left while the host was away.
 * Claims run one at a time, each against the host's page and events read fresh, so the second of
 * two racing bookers is told the time is taken and offered others.
 *
 * What the host writes is its own: the booking's event (busy-only) and its acknowledgement
 * (`cal/booking-ack/<id>`), both in the host's authored namespace on the node. A confirmed or
 * cancelled booking's event is announced on the `cal` topic as an event save is (cal-topic.ts):
 * the kernel's StorageChanged reaches only a workspace-, node- or tree-scoped install's windows,
 * and the topic reaches every instance of the install whatever its scope. The ack is not
 * announced: no pane shows it.
 */
import type { IhttpMessage } from '@/lib/citadel-apps/glue-sdk/ihttp-io';
import type { IhttpRequest } from '@/lib/citadel-apps/glue-sdk/ihttp-server';
import { BOOKING_ACK_PREFIX, BOOKING_PREFIX, bookingAckOf } from './booking';
import { decideClaim, type ClaimVerdict } from './booking-claim';
import { readAcks, sharedSeats } from './group-seats';
import { busyOf, readBookingPage } from './booking-pages';
import { announce } from './cal-topic';
import { decodeCancel, encodeAlternatives, encodeReason, routeOf, type BookingRoute } from './booking-wire';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Booking } from './generated/Booking';
import type { Event } from './generated/Event';
import type { CalendarPorts, CalendarStore } from './ports';
import { EVENT_PREFIX, readSource } from './read-sources';
import type { CalendarEntry } from './store';
import { readTeamTypes, typesHostedBy } from './team-types';
import type { AuthoredKey } from '@/lib/citadel-apps/sdk/generated/AuthoredKey';
import type { HostBusy } from '@/lib/calendar/booking-pages';
import type { Availability } from './generated/Availability';
import type { EventType } from './generated/EventType';
import type { SourceRead } from '@/lib/calendar/read-sources';

export interface HostDeps {
  readonly ports: CalendarPorts;
  readonly engine: CalendarEngine;
  readonly node: string;
  readonly me: string;
  readonly nowMs: () => bigint;
}

const reply = (status: number, body: Uint8Array = new Uint8Array()): IhttpMessage => ({ status, body });
const refuse = (status: number, reason: string): IhttpMessage => reply(status, encodeReason(reason));

export class BookingHost {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly mine: CalendarStore;

  constructor(private readonly d: HostDeps) {
    this.mine = { kind: 'authored', node: d.node, author: d.me };
  }

  /** One claim, cancel or reschedule at a time, in arrival order: the serializer the design names. */
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const turn: Promise<T> = this.queue.then(work);
    this.queue = turn.catch((): void => {});
    return turn;
  }

  readonly handle = (request: IhttpRequest): Promise<IhttpMessage> => this.serialized(() => this.route(request));

  /** The host cancels one of their own bookings, from their calendar. */
  readonly cancelAsHost = (id: string, reason: string | null): Promise<IhttpMessage> => this.serialized(() => this.cancel(id, this.d.me, reason, 'cancelled'));

  private async route(request: IhttpRequest): Promise<IhttpMessage> {
    const route: BookingRoute | null = routeOf(request.path);
    if (request.method !== 'POST' || route === null) return refuse(404, 'no such route');
    if (route.kind === 'cancel') {
      const body: { reason: string | null; } | null = decodeCancel(request.body);
      return body === null ? refuse(400, 'not a cancellation') : this.cancel(route.id, request.caller.username, body.reason, 'cancelled');
    }
    let booking: Booking;
    try {
      booking = this.d.engine.decodeBooking(request.body);
    } catch {
      return refuse(400, 'not a booking');
    }
    if (route.kind === 'book') return this.claim(booking, request.caller.username, null);
    return this.claim({ ...booking, state: { rescheduled: { from: route.id } } }, request.caller.username, route.id);
  }

  /** The host's events now, the one being rescheduled left out. */
  private async entries(except: string | null): Promise<CalendarEntry[]> {
    const { ports, engine, node } = this.d;
    const read: [SourceRead, SourceRead] = await Promise.all([readSource(ports, engine, 'authored', node), readSource(ports, engine, 'node', node)]);
    return read.flatMap((r) => r.entries).filter((e: CalendarEntry) => e.source === 'inherited' || e.event.id !== except);
  }

  /**
   * The host's verdict on `booking`, against its own page and the node's team types it hosts, and
   * what it is busy with now: less the bookings sharing a group slot that still has a seat.
   */
  async decide(booking: Booking, caller: string, except: string | null): Promise<ClaimVerdict> {
    const { ports, engine, node, me } = this.d;
    const [own, team, entries, acks] = await Promise.all([readBookingPage(ports, engine, node, me), readTeamTypes(ports, engine, node), this.entries(except), readAcks(ports, engine, node, me)]);
    const page: { types: EventType[]; host: string; availability: Availability | null; unreadable: number; } = { ...own, types: [...own.types, ...typesHostedBy(team, me)] };
    const type: EventType | undefined = page.types.find((t) => t.id === booking.type_id);
    const seated: Set<string> = new Set(type === undefined ? [] : sharedSeats(type, booking, acks, engine));
    const busy = (fromMs: bigint, toMs: bigint, zone: string): HostBusy => busyOf(entries, me, zone, { fromMs, toMs }, seated, engine);
    return decideClaim({ booking, caller, host: me, node, page, busy, nowMs: this.d.nowMs() }, engine);
  }

  private async claim(booking: Booking, caller: string, rescheduling: string | null): Promise<IhttpMessage> {
    if (rescheduling !== null) {
      const old: Booking | null = await this.ack(rescheduling);
      if (old === null) return refuse(404, 'no such booking');
      if (!this.mayChange(old, caller)) return refuse(403, 'only its booker or host may change a booking');
    }
    const verdict: ClaimVerdict = await this.decide(booking, caller, rescheduling);
    if (verdict.kind === 'refused') return refuse(verdict.status, verdict.reason);
    if (verdict.kind === 'taken') return reply(409, encodeAlternatives(verdict.alternatives));
    await this.confirm(verdict.booking, verdict.event);
    if (rescheduling !== null) await this.cancel(rescheduling, caller, null, 'rescheduled');
    return reply(201, this.d.engine.encodeBooking(verdict.booking));
  }

  private async confirm(booking: Booking, event: Event): Promise<void> {
    const { ports, engine } = this.d;
    await ports.storage.setMany(this.mine, [
      { key: `${EVENT_PREFIX}${booking.id}`, value: engine.encodeEvent(event) },
      { key: `${BOOKING_ACK_PREFIX}${booking.id}`, value: engine.encodeBooking(booking) },
    ]);
    await announce(ports, engine, { node: this.d.node, key: `${EVENT_PREFIX}${booking.id}` });
    // The booking is made once it is written; telling the host is not part of it, so a refused
    // notification (an install without `notifications`) is reported, never the booking failed.
    await ports.notify('bookings', 'New booking', event.title).catch((e: unknown): void => { console.error('[calendar] the host was not notified of a booking', e); });
  }

  private ack(id: string): Promise<Booking | null> {
    return bookingAckOf(this.d.ports, this.d.engine, this.d.node, this.d.me, id);
  }

  private mayChange(booking: Booking, who: string): boolean {
    return who === booking.host || ('member' in booking.booker && booking.booker.member.username === who);
  }

  private async cancel(id: string, by: string, reason: string | null, why: 'cancelled' | 'rescheduled'): Promise<IhttpMessage> {
    const { ports, engine } = this.d;
    const booking: Booking | null = await this.ack(id);
    if (booking === null) return refuse(404, 'no such booking');
    if (!this.mayChange(booking, by)) return refuse(403, 'only its booker or host may cancel a booking');
    const bytes: Uint8Array | null = await ports.storage.get(this.mine, `${EVENT_PREFIX}${id}`);
    const said: string | null = why === 'rescheduled' ? 'rescheduled' : reason;
    const cancelled: Booking = { ...booking, state: { cancelled: { by, reason: said } } };
    const writes: { key: string; value: Uint8Array; }[] = [{ key: `${BOOKING_ACK_PREFIX}${id}`, value: engine.encodeBooking(cancelled) }];
    if (bytes !== null) {
      const event: Event = engine.decodeEvent(bytes);
      writes.push({ key: `${EVENT_PREFIX}${id}`, value: engine.encodeEvent({ ...event, status: { cancelled: { by, reason: said } }, rev: event.rev + 1, updated_ms: this.d.nowMs() }) });
    }
    await ports.storage.setMany(this.mine, writes);
    if (bytes !== null) await announce(ports, engine, { node: this.d.node, key: `${EVENT_PREFIX}${id}` });
    if (why === 'cancelled' && by !== this.d.me) {
      await ports.notify('bookings', 'Booking cancelled', `${by} cancelled${reason === null ? '' : `: ${reason}`}`).catch((e: unknown): void => { console.error('[calendar] the host was not told of a cancellation', e); });
    }
    return reply(200, engine.encodeBooking(cancelled));
  }

  /**
   * The requests members left while the host was away (`cal/booking/<id>` in each booker's
   * namespace), each not yet answered: decided as a live claim would be, the namespace's author
   * (which the kernel stamps) standing for the caller, and answered in an ack. Returns how many.
   */
  async answerRequests(): Promise<number> {
    const { ports, engine, node, me } = this.d;
    const keys: AuthoredKey[] = await ports.storage.authoredKeys(node, BOOKING_PREFIX);
    let answered: number = 0;
    for (const k of keys) {
      const id: string = k.key.slice(BOOKING_PREFIX.length);
      if ((await this.ack(id)) !== null) continue;
      const bytes: Uint8Array | null = await ports.storage.get({ kind: 'authored', node, author: k.author }, k.key);
      if (bytes === null) continue;
      const booking: Booking = engine.decodeBooking(bytes);
      if (booking.host !== me) continue;
      const answer: IhttpMessage = await this.serialized(() => this.claim(booking, k.author, null));
      if (answer.status !== 201) await ports.storage.set(this.mine, `${BOOKING_ACK_PREFIX}${id}`, engine.encodeBooking({ ...booking, state: 'declined' }));
      answered += 1;
    }
    return answered;
  }
}

