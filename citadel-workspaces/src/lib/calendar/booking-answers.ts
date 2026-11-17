/**
 * The booker's side of a request the host answered while the booker could not reach them (design
 * §3.6.1, the offline fallback): the host's next instance writes its answer as an ack in the host's
 * own authored namespace (booking-host.ts `answerRequests`), which only the host can write, as the
 * kernel stamps the author. The booker's instance, on mount and when the ack's StorageChanged
 * arrives, takes each answer to one of its own requests: a confirmed booking becomes the booker's
 * private copy, as a live booking does; the booker is told either way; and the request is removed,
 * so each answer is taken once.
 */
import { BOOKING_PREFIX, bookingAckOf, ownCopy } from './booking';
import { TYPE_PREFIX } from './booking-pages';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Booking } from './generated/Booking';
import type { CalendarPorts, CalendarStore } from './ports';
import { PRIVATE_PREFIX } from './read-sources';

export interface AnswerDeps {
  readonly ports: CalendarPorts;
  readonly engine: CalendarEngine;
  readonly node: string;
  readonly me: string;
  readonly nowMs: bigint;
}

const hostStore = (node: string, host: string): CalendarStore => ({ kind: 'authored', node, author: host });

/** What the booker is told: the type's name with the host, as a live booking names its copy. */
async function titleOf(d: AnswerDeps, request: Booking): Promise<string> {
  const bytes: Uint8Array | null = await d.ports.storage.get(hostStore(d.node, request.host), `${TYPE_PREFIX}${request.type_id}`);
  const name: string = bytes === null ? 'A booking' : d.engine.decodeEventType(bytes).name;
  return `${name} with ${request.host}`;
}

/** An ack is this request's answer only if it names the same booking, host and booker. */
function answers(ack: Booking, request: Booking, me: string): boolean {
  return ack.id === request.id && ack.host === request.host && 'member' in ack.booker && ack.booker.member.username === me;
}

async function tell(d: AnswerDeps, title: string, body: string): Promise<void> {
  // The answer is taken whether or not the booker can be shown a notification (an install without `notifications`).
  await d.ports.notify('bookings', title, body).catch((e: unknown): void => { console.error('[calendar] the booker was not told of an answer', e); });
}

/** Takes every answer to the member's requests on the node; returns how many it took. */
export async function takeAnswers(d: AnswerDeps): Promise<number> {
  const mine: CalendarStore = hostStore(d.node, d.me);
  let taken: number = 0;
  for (const key of await d.ports.storage.keys(mine, BOOKING_PREFIX)) {
    const bytes: Uint8Array | null = await d.ports.storage.get(mine, key);
    if (bytes === null) continue;
    const request: Booking = d.engine.decodeBooking(bytes);
    const ack: Booking | null = await bookingAckOf(d.ports, d.engine, d.node, request.host, request.id);
    if (ack === null || !answers(ack, request, d.me)) continue;
    const title: string = await titleOf(d, request);
    if (ack.state === 'confirmed') {
      await d.ports.storage.set({ kind: 'user' }, `${PRIVATE_PREFIX}${ack.id}`, d.engine.encodeEvent(ownCopy(ack, { node: d.node, me: d.me, title, nowMs: d.nowMs })));
      await tell(d, 'Booking confirmed', `${title} is booked.`);
    } else {
      await tell(d, 'Booking not made', `${title} was not booked; pick another time.`);
    }
    await d.ports.storage.remove(mine, key);
    taken += 1;
  }
  return taken;
}
