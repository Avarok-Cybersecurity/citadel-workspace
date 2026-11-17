/**
 * A team's type on its booking page (design §3.6.2): each host's hours on this node are read, and
 * the times offered are a round robin's (any host free) or a collective's (every host free), from
 * team-slots.ts. On Confirm a round robin is handed its free hosts in the core's order, counted
 * against what each host already has booked that month; a collective, all of its hosts.
 */
import { useEffect, useMemo, useState } from 'react';
import { busyOf, readBookingPage, type BookingPageData, type HostBusy } from '@/lib/calendar/booking-pages';
import type { BookingChoice, BookOutcome } from '@/lib/calendar/booking-form';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { Availability } from '@/lib/calendar/generated/Availability';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { Interval } from '@/lib/calendar/generated/Interval';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import type { CalendarEntry } from '@/lib/calendar/store';
import type { BookTarget } from '@/lib/calendar/team-booking';
import { freeAt, rankedFor, teamSlots, type HostSource, type SlotAsk } from '@/lib/calendar/team-slots';
import { teamHosts } from '@/lib/calendar/team-types';
import { BookingPage } from './BookingPage';

interface TeamBookingProps {
  ports: CalendarPorts;
  engine: CalendarEngine;
  node: { id: string; name: string };
  type: EventType;
  entries: ReadonlyMap<string, CalendarEntry>;
  displayZone: string;
  deviceZone: string;
  today: CivilDate;
  nowMs: bigint;
  onBook: (target: BookTarget, choice: BookingChoice) => Promise<BookOutcome>;
}

type Hours = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; byHost: ReadonlyMap<string, Availability | null> };

/** A team's type is a round robin or a collective: neither has seats (group-seats.ts). */
const NO_SEATS: ReadonlySet<string> = new Set();
const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');

function closedCopy(type: EventType, byHost: ReadonlyMap<string, Availability | null>): string | null {
  const without: string[] = [...byHost].filter(([, a]) => a === null).map(([h]) => h);
  const collective: boolean = typeof type.kind === 'object' && 'collective' in type.kind;
  if (collective && without.length > 0) return `${type.name} cannot be booked yet: ${without.join(', ')} ${without.length === 1 ? 'has' : 'have'} no hours on this page.`;
  if (without.length === byHost.size) return `${type.name} cannot be booked yet: none of its hosts has hours on this page.`;
  return null;
}

export function TeamBooking(p: TeamBookingProps): JSX.Element {
  const { ports, engine, node, type, entries } = p;
  const hosts: string[] = useMemo(() => teamHosts(type) ?? [], [type]);
  const [hours, setHours] = useState<Hours>({ kind: 'loading' });
  useEffect(() => {
    Promise.all(hosts.map((h: string) => readBookingPage(ports, engine, node.id, h))).then(
      (pages: BookingPageData[]): void => setHours({ kind: 'ready', byHost: new Map(pages.map((pg: BookingPageData) => [pg.host, pg.availability])) }),
      (e: unknown): void => setHours({ kind: 'failed', reason: reasonOf(e) }),
    );
  }, [ports, engine, node.id, hosts]);
  const source: HostSource = useMemo(() => (host: string) => ({
    availability: hours.kind === 'ready' ? hours.byHost.get(host) ?? null : null,
    busyFor: (fromMs: bigint, toMs: bigint, zone: string): HostBusy => busyOf(entries.values(), host, zone, { fromMs, toMs }, NO_SEATS, engine),
  }), [hours, entries, engine]);
  const slotsFor: (ask: SlotAsk) => Interval[] = useMemo(() => (ask: SlotAsk): Interval[] => teamSlots(engine, ask, source).slots, [engine, source]);

  if (hours.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading the hours of {type.name}&apos;s hosts…</p>;
  if (hours.kind === 'failed') return <p role="alert" className="text-sm text-destructive-emphasis">The hours of {type.name}&apos;s hosts could not be read: {hours.reason}.</p>;
  const book = (choice: BookingChoice): Promise<BookOutcome> => {
    if (typeof type.kind === 'object' && 'collective' in type.kind) return p.onBook({ kind: 'collective', hosts }, choice);
    const day: CivilDate = engine.civilOf(choice.zone, choice.slot.start_ms).date;
    const around: SlotAsk = { type, durationMin: choice.durationMin, nowMs: p.nowMs, from: engine.addDays(day, -1), to: engine.addDays(day, 1) };
    const free: readonly string[] = freeAt(teamSlots(engine, around, source), choice.slot);
    return p.onBook({ kind: 'round_robin', ranked: rankedFor(engine, type, choice.slot, free, entries.values()) }, choice);
  };
  return (
    <BookingPage
      hostName={type.name} types={[type]} closed={closedCopy(type, hours.byHost)} engine={engine} displayZone={p.displayZone} deviceZone={p.deviceZone}
      today={p.today} nowMs={p.nowMs} slotsFor={slotsFor} initialTypeId={type.id} onBook={book}
    />
  );
}
