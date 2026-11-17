/**
 * A member's booking page on a node (design §3.6.1): the event types they offer there and the
 * schedule slots are computed from. The design's table (§3.3.2) keeps both in `storage.user`, which
 * no other member can read, so a booker could never compute a slot; they live instead in the
 * host's authored namespace on the node (`storage.node.authored(n, host)`), which every viewer of
 * the node reads and only the host writes (the kernel stamps the author). One copy, the host's.
 *
 * What the host is already busy with is not stored again: it is derived from the events the pane
 * has read (`busyOf`), the host's confirmed bookings among them.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { Availability } from './generated/Availability';
import type { BookedDay } from './generated/BookedDay';
import type { CivilDate } from './generated/CivilDate';
import type { Event } from './generated/Event';
import type { EventType } from './generated/EventType';
import type { Interval } from './generated/Interval';
import { dateKey } from './grid-keyboard';
import type { CalendarPorts, CalendarStore } from './ports';
import type { CalendarEntry } from './store';
import type { AuthoredKey } from '@/lib/citadel-apps/sdk/generated/AuthoredKey';

export const TYPE_PREFIX: string = 'cal/type/';
export const AVAILABILITY_KEY: string = 'cal/availability';

export interface BookingPageData {
  readonly host: string;
  readonly types: EventType[];
  /** Null until the host has saved a schedule on this node: nothing can be booked yet. */
  readonly availability: Availability | null;
  /** Values the core could not decode, left out and counted. */
  readonly unreadable: number;
}

const hostStore = (node: string, host: string): CalendarStore => ({ kind: 'authored', node, author: host });

export async function readBookingPage(ports: CalendarPorts, engine: CalendarEngine, node: string, host: string): Promise<BookingPageData> {
  const store: CalendarStore = hostStore(node, host);
  const keys: string[] = (await ports.storage.authoredKeys(node, TYPE_PREFIX)).filter((k) => k.author === host).map((k) => k.key);
  const [schedule, ...values] = await Promise.all([ports.storage.get(store, AVAILABILITY_KEY), ...keys.map((key: string) => ports.storage.get(store, key))]);
  let unreadable: number = 0;
  const decode = <T>(bytes: Uint8Array | null | undefined, as: (b: Uint8Array) => T): T | null => {
    if (bytes === null || bytes === undefined) return null;
    try {
      return as(bytes);
    } catch {
      unreadable += 1;
      return null;
    }
  };
  const types: EventType[] = values
    .map((bytes) => decode(bytes, (b: Uint8Array) => engine.decodeEventType(b)))
    .filter((t: EventType | null): t is EventType => t !== null)
    .sort((a: EventType, b: EventType): number => a.name.localeCompare(b.name));
  const availability: Availability | null = decode(schedule, (b: Uint8Array) => engine.decodeAvailability(b));
  return { host, types, availability, unreadable };
}

/** The members who offer at least one type on `node`, by name. */
export async function hostsOn(ports: CalendarPorts, node: string): Promise<string[]> {
  const keys: AuthoredKey[] = await ports.storage.authoredKeys(node, TYPE_PREFIX);
  return [...new Set(keys.map((k) => k.author))].sort((a: string, b: string) => a.localeCompare(b));
}

export const saveEventType = (ports: CalendarPorts, engine: CalendarEngine, node: string, me: string, type: EventType): Promise<void> =>
  ports.storage.set(hostStore(node, me), `${TYPE_PREFIX}${type.id}`, engine.encodeEventType(type));

export const removeEventType = (ports: CalendarPorts, node: string, me: string, typeId: string): Promise<void> =>
  ports.storage.remove(hostStore(node, me), `${TYPE_PREFIX}${typeId}`);

export const saveAvailability = (ports: CalendarPorts, engine: CalendarEngine, node: string, me: string, availability: Availability): Promise<void> =>
  ports.storage.set(hostStore(node, me), AVAILABILITY_KEY, engine.encodeAvailability(availability));

export interface HostBusy {
  readonly busy: Interval[];
  readonly booked: BookedDay[];
}

const eventOf = (entry: CalendarEntry): Event | null => (entry.source === 'inherited' ? null : entry.event);

/**
 * What `host` is busy with between `fromMs` and `toMs` among the entries read, less the events
 * named in `except` (a group slot's seated bookings, group-seats.ts): every confirmed timed event they host or wrote (a recurring one by the core's expansion in its own zone; an
 * all-day event does not block hours), and per day, in `zone` (the schedule's), how many of
 * those are bookings. An occurrence the core cannot place is left out here; the pane already
 * lists it as one it could not place.
 */
export function busyOf(entries: Iterable<CalendarEntry>, host: string, zone: string, range: { fromMs: bigint; toMs: bigint }, except: ReadonlySet<string>, engine: Pick<CalendarEngine, 'civilOf' | 'expand'>): HostBusy {
  const busy: Interval[] = [];
  const perDay: Map<string, BookedDay> = new Map();
  const seen: Set<string> = new Set();
  for (const entry of entries) {
    const event: Event | null = eventOf(entry);
    if (event === null || event.status !== 'confirmed' || seen.has(event.id) || except.has(event.id)) continue;
    if (event.author !== host && !event.hosts.includes(host)) continue;
    seen.add(event.id);
    if ('once' in event.when) {
      busy.push({ start_ms: event.when.once.start_ms, end_ms: event.when.once.end_ms });
      if (typeof event.kind !== 'object') continue;
      const date: CivilDate = engine.civilOf(zone, event.when.once.start_ms).date;
      const day: BookedDay | undefined = perDay.get(dateKey(date));
      perDay.set(dateKey(date), { date, count: (day?.count ?? 0) + 1 });
    } else if ('recurring' in event.when) {
      try {
        for (const o of engine.expand(event.when.recurring, event.zone, range.fromMs, range.toMs).occurrences) busy.push({ start_ms: o.start_ms, end_ms: o.end_ms });
      } catch {
        // Listed by the pane as an event it could not place (placement.ts).
      }
    }
  }
  return { busy, booked: [...perDay.values()] };
}
