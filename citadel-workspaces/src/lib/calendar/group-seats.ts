/**
 * A group type's seats (design §3.6.3): a slot of a group type stays bookable while it has seats
 * left, so the bookings already in that very slot of that type do not make the host busy for the
 * next booker until the last seat is taken. One rule, `sharedSeats`, which the host's instance
 * applies at claim (booking-host.ts) and the booker's page applies to the times it lists
 * (`bookerSlots`), so a page never hides a time the host would confirm, nor offers one it would not.
 */
import { BOOKING_ACK_PREFIX } from './booking';
import type { HostBusy } from './booking-pages';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Availability } from './generated/Availability';
import type { Booking } from './generated/Booking';
import type { EventType } from './generated/EventType';
import type { Interval } from './generated/Interval';
import type { CalendarPorts } from './ports';
import { askRequest, hostSlots, type SlotAsk } from './team-slots';
import type { SlotRequest } from './generated/SlotRequest';

const live = (b: Booking): boolean => b.state === 'confirmed' || (typeof b.state === 'object' && 'rescheduled' in b.state);

/** A slot of one type, as a booking names it; `id` is the booking itself, left out of its own seats (null: none). */
export interface SeatSlot {
  readonly id: string | null;
  readonly type_id: string;
  readonly start_ms: bigint;
  readonly end_ms: bigint;
}

/**
 * The ids of the host's bookings that share `slot` and still leave a seat: the events the busy
 * check leaves out. Empty for any other kind, or when the slot is full.
 */
export function sharedSeats(type: EventType, slot: SeatSlot, acks: readonly Booking[], engine: Pick<CalendarEngine, 'team'>): string[] {
  if (typeof type.kind !== 'object' || !('group' in type.kind)) return [];
  const same: Booking[] = acks.filter((b: Booking) => b.id !== slot.id && live(b) && b.type_id === slot.type_id
    && b.start_ms === slot.start_ms && b.end_ms === slot.end_ms);
  return engine.team.seatsLeft(type.kind.group.seats, same.length) > 0 ? same.map((b: Booking) => b.id) : [];
}

/** Every booking `host` has answered on `node` (`cal/booking-ack/<id>` in their authored namespace). */
export async function readAcks(ports: CalendarPorts, engine: CalendarEngine, node: string, host: string): Promise<Booking[]> {
  const keys: string[] = (await ports.storage.authoredKeys(node, BOOKING_ACK_PREFIX)).filter((k) => k.author === host).map((k) => k.key);
  const values: (Uint8Array | null)[] = await Promise.all(keys.map((key: string) => ports.storage.get({ kind: 'authored', node, author: host }, key)));
  return values.filter((b): b is Uint8Array => b !== null).map((b: Uint8Array) => engine.decodeBooking(b));
}

/** What a host is busy with between two instants, in a zone, less the events named in `except`. */
export type BusyExcept = (fromMs: bigint, toMs: bigint, zone: string, except: ReadonlySet<string>) => HostBusy;

const NONE: ReadonlySet<string> = new Set();
const keyOf = (s: Interval): string => `${s.start_ms}-${s.end_ms}`;
const byStart = (a: Interval, b: Interval): number => (a.start_ms < b.start_ms ? -1 : a.start_ms > b.start_ms ? 1 : 0);

type Engine = Pick<CalendarEngine, 'instantOf' | 'addDays' | 'freeSlots' | 'collectiveSlots' | 'offers' | 'team'>;

/**
 * The times a member's page offers for `ask`: the host's free slots, and each slot of a group type
 * already booked that still has a seat, when the host's own check (the core's `offers`, with that
 * slot's seated bookings left out of what they are busy with) would confirm it.
 */
export function bookerSlots(engine: Engine, ask: SlotAsk, availability: Availability | null, busyFor: BusyExcept, acks: readonly Booking[]): Interval[] {
  const free: Interval[] = hostSlots(engine, ask, availability, (f: bigint, t: bigint, z: string) => busyFor(f, t, z, NONE));
  if (availability === null) return free;
  const length: bigint = BigInt(ask.durationMin) * 60_000n;
  const offered: Map<string, Interval> = new Map(free.map((s: Interval) => [keyOf(s), s]));
  for (const b of acks) {
    const slot: Interval = { start_ms: b.start_ms, end_ms: b.end_ms };
    if (b.type_id !== ask.type.id || slot.end_ms - slot.start_ms !== length || offered.has(keyOf(slot))) continue;
    const seated: Set<string> = new Set(sharedSeats(ask.type, { id: null, type_id: ask.type.id, ...slot }, acks, engine));
    if (seated.size === 0) continue;
    const request: SlotRequest = askRequest(engine, ask, availability, (f: bigint, t: bigint, z: string) => busyFor(f, t, z, seated));
    if (engine.offers(request, slot)) offered.set(keyOf(slot), slot);
  }
  return [...offered.values()].sort(byStart);
}
