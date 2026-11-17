/**
 * The host's decision on a booking (design §3.6.1 step 3), pure: the host's instance is the
 * serializer, and before it confirms it checks the booking again against its own page and what it
 * is busy with now, so two bookers racing for one slot cannot both win. Who booked is the caller the
 * kernel stamped, never the body's word; the body may only book its own caller.
 *
 * A confirmed booking becomes the host's event on the node, busy-only to everyone else, so every
 * other booker's slot list (booking-pages.ts `busyOf`) leaves the time out.
 */
import { checkAnswers } from './booking-form';
import type { BookingPageData, HostBusy } from './booking-pages';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Booking } from './generated/Booking';
import type { CivilDate } from './generated/CivilDate';
import type { Event } from './generated/Event';
import type { EventType } from './generated/EventType';
import type { Interval } from './generated/Interval';
import { slotRequest, type SlotInput } from './slot-list';
import type { FormCheck } from '@/lib/calendar/booking-form';
import type { Availability } from './generated/Availability';

/** How many other times a lost race is offered, and over how many days from its date. */
export const MAX_ALTERNATIVES: number = 5;
export const ALTERNATIVE_DAYS: number = 7;

export type ClaimVerdict =
  | { readonly kind: 'confirm'; readonly booking: Booking; readonly event: Event }
  | { readonly kind: 'taken'; readonly alternatives: Interval[] }
  | { readonly kind: 'refused'; readonly status: 403 | 404 | 422; readonly reason: string };

export interface ClaimInput {
  readonly booking: Booking;
  /** The session's word for who is booking (`Caller.username`). */
  readonly caller: string;
  readonly host: string;
  readonly node: string;
  readonly page: BookingPageData;
  /** What the host is busy with now, read fresh for this claim. */
  readonly busy: (fromMs: bigint, toMs: bigint, zone: string) => HostBusy;
  readonly nowMs: bigint;
}

type Engine = Pick<CalendarEngine, 'offers' | 'freeSlots' | 'civilOf' | 'addDays' | 'instantOf'>;

const bookerOf = (b: Booking): string => ('member' in b.booker ? b.booker.member.username : b.booker.guest.account);

function slotInput(type: EventType, durationMin: number, input: ClaimInput, from: CivilDate, to: CivilDate, engine: Engine): SlotInput {
  const availability: Availability | null = input.page.availability;
  if (availability === null) throw new Error('a claim needs the host\'s schedule');
  const fromMs: bigint = engine.instantOf(availability.zone, { date: from, minute: 0 });
  const toMs: bigint = engine.instantOf(availability.zone, { date: engine.addDays(to, 1), minute: 0 });
  const { busy, booked } = input.busy(fromMs, toMs, availability.zone);
  return { type, durationMin, availability, busy, booked, nowMs: input.nowMs, from, to };
}

export function decideClaim(input: ClaimInput, engine: Engine): ClaimVerdict {
  const { booking, page } = input;
  if (bookerOf(booking) !== input.caller) return { kind: 'refused', status: 403, reason: 'a booking may only be made for its caller' };
  if (booking.host !== input.host || page.availability === null) return { kind: 'refused', status: 404, reason: 'this member takes no bookings here' };
  const type: EventType | undefined = page.types.find((t: EventType) => t.id === booking.type_id);
  if (type === undefined) return { kind: 'refused', status: 404, reason: 'no such event type' };
  const minutes: bigint = (booking.end_ms - booking.start_ms) / 60_000n;
  if ((booking.end_ms - booking.start_ms) % 60_000n !== 0n || !type.durations_min.includes(Number(minutes))) return { kind: 'refused', status: 422, reason: 'not a length this type offers' };
  const answers: FormCheck = checkAnswers(type.questions, new Map(booking.answers.map((a) => [a.question_id, a.value])));
  if (!answers.ok) return { kind: 'refused', status: 422, reason: [...answers.errors.values()].join(' ') };

  const zone: string = page.availability.zone;
  const slot: Interval = { start_ms: booking.start_ms, end_ms: booking.end_ms };
  const date: CivilDate = engine.civilOf(zone, slot.start_ms).date;
  const around: SlotInput = slotInput(type, Number(minutes), input, engine.addDays(date, -1), engine.addDays(date, 1), engine);
  if (!engine.offers(slotRequest(around), slot)) {
    const ahead: SlotInput = slotInput(type, Number(minutes), input, date, engine.addDays(date, ALTERNATIVE_DAYS - 1), engine);
    const alternatives: Interval[] = engine.freeSlots(slotRequest(ahead)).filter((s: Interval) => s.start_ms >= input.nowMs).slice(0, MAX_ALTERNATIVES);
    return { kind: 'taken', alternatives };
  }
  // A reschedule is confirmed as what it is: the booking it replaced stays named.
  const moved: boolean = typeof booking.state === 'object' && 'rescheduled' in booking.state;
  const confirmed: Booking = { ...booking, state: moved ? booking.state : 'confirmed', answers: answers.answers };
  const event: Event = {
    id: booking.id, rev: 1, origin_node: input.node, author: input.host, title: `${type.name} with ${bookerOf(booking)}`, body: null,
    kind: { booking: { booking_id: booking.id } }, status: 'confirmed', when: { once: { start_ms: slot.start_ms, end_ms: slot.end_ms } }, zone,
    location: 'in_app', hosts: [input.host], invitees: [{ member: { username: bookerOf(booking) } }], visibility: 'busy_only',
    propagate: { down: false, up_to: null }, reminders: [], notes_doc: null, source: null, created_ms: input.nowMs, updated_ms: input.nowMs,
  };
  return { kind: 'confirm', booking: confirmed, event };
}
