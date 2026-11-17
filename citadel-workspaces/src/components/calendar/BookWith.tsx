/**
 * "Book with someone" on this node (design §3.6.1 step 1, §3.6.2, §3.6.3): the members who offer a
 * type here, the node's team types, and its routing forms, which lead a booker who is not sure to
 * one of them; then the chosen member's or team's booking page. A member deep link
 * (booking-link.ts) arrives with the host and type already chosen. What a host is busy with comes
 * from the events this pane has read.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { busyOf, hostsOn, readBookingPage, type BookingPageData } from '@/lib/calendar/booking-pages';
import type { BookingChoice, BookOutcome } from '@/lib/calendar/booking-form';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { Booking } from '@/lib/calendar/generated/Booking';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { RoutingForm } from '@/lib/calendar/generated/RoutingForm';
import type { RoutingTarget } from '@/lib/calendar/generated/RoutingTarget';
import { bookerSlots, readAcks } from '@/lib/calendar/group-seats';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { readRoutingForms } from '@/lib/calendar/routing-forms';
import { routedTo, type Routed } from '@/lib/calendar/routing-target';
import type { CalendarEntry } from '@/lib/calendar/store';
import type { BookTarget } from '@/lib/calendar/team-booking';
import type { SlotAsk } from '@/lib/calendar/team-slots';
import { readTeamTypes } from '@/lib/calendar/team-types';
import { BookingPage } from './BookingPage';
import { RoutingAnswer } from './RoutingAnswer';
import { TeamBooking } from './TeamBooking';
import type { Interval } from '@/lib/calendar/generated/Interval';

interface BookWithProps {
  ports: CalendarPorts;
  engine: CalendarEngine;
  node: { id: string; name: string };
  me: string;
  entries: ReadonlyMap<string, CalendarEntry>;
  displayZone: string;
  deviceZone: string;
  today: CivilDate;
  nowMs: bigint;
  origin: string;
  nodeName: (id: string) => string;
  initial: { host: string; typeId: string | null } | null;
  onBook: (target: BookTarget, choice: BookingChoice) => Promise<BookOutcome>;
}

type Choices = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; hosts: string[]; teams: EventType[]; forms: RoutingForm[] };
type Page = { kind: 'none' } | { kind: 'loading'; host: string } | { kind: 'failed'; host: string; reason: string } | { kind: 'ready'; page: BookingPageData; acks: Booking[] } | { kind: 'team'; type: EventType };

const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');
/** A poll is voted on, not booked as a slot. */
const bookable = (types: EventType[]): EventType[] => types.filter((t: EventType) => t.kind !== 'poll');
const CHOICE_LINK: string = 'flex min-h-[44px] items-center self-start rounded-md border border-border px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function BookWith(p: BookWithProps): JSX.Element {
  const { ports, engine, node, me, entries } = p;
  const [choices, setChoices] = useState<Choices>({ kind: 'loading' });
  const [page, setPage] = useState<Page>({ kind: 'none' });
  const [away, setAway] = useState<Extract<Routed, { kind: 'away' }> | null>(null);
  const open: (host: string) => void = useCallback((host: string): void => {
    setAway(null);
    setPage({ kind: 'loading', host });
    Promise.all([readBookingPage(ports, engine, node.id, host), readAcks(ports, engine, node.id, host)]).then(
      ([data, acks]): void => setPage({ kind: 'ready', page: data, acks }),
      (e: unknown): void => setPage({ kind: 'failed', host, reason: reasonOf(e) }),
    );
  }, [ports, engine, node.id]);
  const openTeam = (type: EventType): void => {
    setAway(null);
    setPage({ kind: 'team', type });
  };
  useEffect(() => {
    Promise.all([hostsOn(ports, node.id), readTeamTypes(ports, engine, node.id), readRoutingForms(ports, engine, node.id)]).then(
      ([hosts, team, routing]): void => setChoices({ kind: 'ready', hosts: hosts.filter((h: string) => h !== me), teams: team.types, forms: routing.forms }),
      (e: unknown): void => setChoices({ kind: 'failed', reason: reasonOf(e) }),
    );
  }, [ports, engine, node.id, me]);
  const initialHost: string | null = p.initial?.host ?? null;
  useEffect(() => { if (initialHost !== null) open(initialHost); }, [initialHost, open]);
  const shown: Extract<Page, { kind: 'ready' }> | null = page.kind === 'ready' ? page : null;
  const slotsFor: (ask: SlotAsk) => Interval[] = useMemo(() => (ask: SlotAsk): Interval[] => bookerSlots(engine, ask, shown?.page.availability ?? null,
    (fromMs: bigint, toMs: bigint, zone: string, except: ReadonlySet<string>) => busyOf(entries.values(), shown?.page.host ?? '', zone, { fromMs, toMs }, except, engine), shown?.acks ?? []), [entries, engine, shown]);
  const routed = (target: RoutingTarget, teams: readonly EventType[]): void => {
    const to: Routed = routedTo(target, { node: node.id, teams, origin: p.origin, nodeName: p.nodeName });
    if (to.kind === 'member') open(to.host);
    else if (to.kind === 'team') openTeam(to.type);
    else {
      setPage({ kind: 'none' });
      setAway(to);
    }
  };

  return (
    <section aria-label="Book with someone" className="flex min-w-0 flex-col gap-4" data-testid="calendar-book-with">
      {choices.kind === 'loading' && <p role="status" className="text-sm text-muted-foreground">Finding who can be booked on {node.name}…</p>}
      {choices.kind === 'failed' && <p role="alert" className="text-sm text-destructive-emphasis">Who can be booked could not be read: {choices.reason}.</p>}
      {choices.kind === 'ready' && choices.hosts.length === 0 && choices.teams.length === 0 && page.kind === 'none' && (
        <p role="status" className="text-sm text-muted-foreground">Nobody else offers bookings on {node.name} yet.</p>
      )}
      {choices.kind === 'ready' && choices.forms.length > 0 && <RoutingAnswer engine={engine} forms={choices.forms} onRouted={(t: RoutingTarget): void => routed(t, choices.teams)} />}
      {away !== null && <a href={away.href} className={CHOICE_LINK}>{away.label}</a>}
      {choices.kind === 'ready' && choices.hosts.length > 0 && (
        <div role="group" aria-label="People you can book" className="flex min-w-0 flex-wrap gap-2">
          {choices.hosts.map((h: string) => {
            const on: boolean = (page.kind === 'ready' && page.page.host === h) || ((page.kind === 'loading' || page.kind === 'failed') && page.host === h);
            return <Button key={h} variant={on ? 'default' : 'outline'} aria-pressed={on} className="h-[44px]" onClick={(): void => open(h)}>{h}</Button>;
          })}
        </div>
      )}
      {choices.kind === 'ready' && choices.teams.length > 0 && (
        <div role="group" aria-label="Teams you can book" className="flex min-w-0 flex-wrap gap-2">
          {choices.teams.map((t: EventType) => {
            const on: boolean = page.kind === 'team' && page.type.id === t.id;
            return <Button key={t.id} variant={on ? 'default' : 'outline'} aria-pressed={on} className="h-[44px]" onClick={(): void => openTeam(t)}>{t.name}</Button>;
          })}
        </div>
      )}
      {page.kind === 'loading' && <p role="status" className="text-sm text-muted-foreground">Loading {page.host}&apos;s booking page…</p>}
      {page.kind === 'failed' && <p role="alert" className="text-sm text-destructive-emphasis">{page.host}&apos;s booking page could not be read: {page.reason}.</p>}
      {page.kind === 'ready' && (
        <BookingPage
          key={page.page.host} hostName={page.page.host} types={bookable(page.page.types)} closed={page.page.availability === null ? `${page.page.host} has not opened bookings on this page yet.` : null}
          engine={engine} displayZone={p.displayZone} deviceZone={p.deviceZone} today={p.today} nowMs={p.nowMs} slotsFor={slotsFor}
          initialTypeId={p.initial?.host === page.page.host ? p.initial.typeId : null}
          onBook={(choice: BookingChoice): Promise<BookOutcome> => p.onBook({ kind: 'member', host: page.page.host }, choice)}
        />
      )}
      {page.kind === 'team' && (
        <TeamBooking key={page.type.id} ports={ports} engine={engine} node={node} type={page.type} entries={entries} displayZone={p.displayZone} deviceZone={p.deviceZone} today={p.today} nowMs={p.nowMs} onBook={p.onBook} />
      )}
    </section>
  );
}
