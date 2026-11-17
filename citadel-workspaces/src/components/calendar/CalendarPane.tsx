/**
 * The Calendar pane once the core and the member's zone are known (design §3.9): the views over
 * the store kept read from storage, and in the page's flow the panels a member opens from them:
 * a new event, their booking page on this node, and booking someone else (which a member deep
 * link opens directly). Ids and the clock are read here, at the pane's edge; nothing below reads
 * a port, a clock or the address.
 */
import { useCallback, useMemo, useReducer, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { bookingTargetOf } from '@/lib/calendar/booking-link';
import type { BookingChoice, BookOutcome } from '@/lib/calendar/booking-form';
import { book as claim, bookingAckOf, bookingOf, bookingRole, cancelAsBooker, requestBooking, type BookingRole } from '@/lib/calendar/booking';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { EventCheck } from '@/lib/calendar/event-draft';
import { cancelEvent, saveRevision } from '@/lib/calendar/event-change';
import { changeableBy, draftOf } from '@/lib/calendar/event-edit';
import { saveEvent as save, type SaveOutcome } from '@/lib/calendar/event-save';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { Chip } from '@/lib/calendar/placement';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { calendarReducer, initialCalendar, type CalendarEntry, type CalendarState, type EventEntry } from '@/lib/calendar/store';
import { bookCollective, bookRoundRobin, type BookTarget } from '@/lib/calendar/team-booking';
import { useCalendarSources } from '@/lib/calendar/use-calendar-sources';
import { nodeZone } from '@/lib/calendar/zones';
import { dateKey } from '@/lib/calendar/grid-keyboard';
import { BookingSetup } from './BookingSetup';
import { BookWith } from './BookWith';
import { PollsPanel } from './PollsPanel';
import { CalendarTab } from './CalendarTab';
import { EventDetails } from './EventDetails';
import { EventEditor } from './EventEditor';
import { useAbove } from './use-above';
import { SdkAppsPanel } from './SdkAppsPanel';
import { CalendarNotifications } from './CalendarNotifications';
import { readPrefs } from '@/lib/calendar/notice-gate';
import { SdkConsentPrompt } from './SdkConsentPrompt';
import { useBookings } from './use-bookings';
import { useSdkConsent } from './use-sdk-consent';
import { useMinuteClock } from './use-minute-clock';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import type { IhttpMessage } from '@/lib/citadel-apps/glue-sdk/ihttp-io';
import type { IhttpClient } from '@/lib/citadel-apps/glue-sdk/ihttp-client';
import type { Booking } from '@/lib/calendar/generated/Booking';
import type { NamedNode } from '@/components/calendar/PropagationFields';
import type { SdkConsent } from '@/components/calendar/use-sdk-consent';
import type { CivilDateTime } from '@/lib/calendar/generated/CivilDateTime';
import type { Event } from '@/lib/calendar/generated/Event';

/** Below this width the Calendar opens on Agenda, which reads as a list on a phone. */
const NARROW_PX: number = 640;

export interface CalendarPaneProps {
  ports: CalendarPorts;
  engine: CalendarEngine;
  nodeId: string;
  me: string;
  displayZone: string;
  deviceZone: string;
  /** What the install holds for this member: which booking planes it may serve and call on. */
  held: ReadonlySet<Capability>;
  /** Whether the member holds `EditMdx` on this node: who may change its own events. */
  mayEditNode: boolean;
}

type Panel = { kind: 'none' } | { kind: 'new'; date: CivilDate; reminders: readonly number[] } | { kind: 'edit'; entry: EventEntry } | { kind: 'setup' } | { kind: 'polls' } | { kind: 'apps' } | { kind: 'notifications' }
  /** `moving`: the booking this one replaces, with the host and type it was made with. */
  | { kind: 'book'; moving: { id: string; host: string; typeId: string } | null };

const newId = (): string => crypto.randomUUID();
const nowOf = (ports: CalendarPorts): bigint => BigInt(Math.floor(ports.clock.now()));
const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');

export function CalendarPane({ ports, engine, nodeId, me, displayZone, deviceZone, held, mayEditNode }: CalendarPaneProps): JSX.Element {
  const { state: ws } = useWorkspace();
  const now: CivilDateTime = useMinuteClock(engine, displayZone, ports.clock);
  const nowMs: bigint = useMemo(() => engine.instantOf(displayZone, now), [engine, displayZone, now]);
  const [state, dispatch] = useReducer(calendarReducer, undefined, (): CalendarState =>
    initialCalendar(window.innerWidth < NARROW_PX ? 'agenda' : 'month', now.date));
  const [linked] = useState(() => bookingTargetOf(window.location.search, nodeId));
  const [panel, setPanel] = useState<Panel>(linked === null ? { kind: 'none' } : { kind: 'book', moving: null });
  const [open, setOpen] = useState<Chip | null>(null);
  useCalendarSources(ports, engine, nodeId, dispatch);
  const consent: SdkConsent = useSdkConsent();
  const { client, host } = useBookings(ports, engine, nodeId, me, held, consent.ask);
  const nodeName: (id: string) => string = useCallback((id: string): string => ws.nodes[id]?.name ?? 'a page you cannot see', [ws.nodes]);
  const zone: string | null = useMemo(() => nodeZone(ws.nodes, nodeId, ws.workspace?.metadata), [ws.nodes, nodeId, ws.workspace?.metadata]);
  const node: { id: string; name: string; } = { id: nodeId, name: ws.nodes[nodeId]?.name ?? 'This page' };
  const close = (): void => setPanel({ kind: 'none' });
  /** A new event starts with the member's chosen reminders, read as it is opened so a change elsewhere holds. */
  const create = (date: CivilDate): void => {
    readPrefs(ports.storage).then((p) => setPanel({ kind: 'new', date, reminders: p.leadMinutes }), (e: unknown): void => {
      console.error('[calendar] the notification settings could not be read; the new event starts with no reminder', e);
      setPanel({ kind: 'new', date, reminders: [] });
    });
  };

  const above: readonly NamedNode[] = useAbove(ports, nodeId, nodeName);
  const saveEvent = (checked: Extract<EventCheck, { ok: true }>, progress: (done: number, of: number) => void): Promise<SaveOutcome> =>
    save(ports, engine, checked, null, progress);
  const book = (target: BookTarget, choice: BookingChoice): Promise<BookOutcome> => {
    const first: string = target.kind === 'member' ? target.host : (target.kind === 'round_robin' ? target.ranked : target.hosts)[0] ?? '';
    const booking: Booking = bookingOf(choice, { id: newId(), node: nodeId, host: first, me });
    const moving: string | null = panel.kind === 'book' && panel.moving !== null ? panel.moving.id : null;
    if (client === null) {
      if (moving !== null) return Promise.resolve<BookOutcome>({ kind: 'failed', reason: 'a booking can be moved only while its host can be reached' });
      if (target.kind === 'collective') return Promise.resolve<BookOutcome>({ kind: 'failed', reason: 'a booking with every host at once can be made only while they can be reached' });
      return first === '' ? Promise.resolve<BookOutcome>({ kind: 'failed', reason: 'no host is free at that time' }) : requestBooking(ports, engine, booking, nodeId, me);
    }
    const deps: { ports: CalendarPorts; engine: CalendarEngine; client: IhttpClient; node: string; me: string; title: string; nowMs: bigint; } = { ports, engine, client, node: nodeId, me, title: target.kind === 'member' ? `${choice.type.name} with ${target.host}` : choice.type.name, nowMs: nowOf(ports) };
    if (target.kind === 'round_robin') return bookRoundRobin(deps, booking, target.ranked);
    if (target.kind === 'collective') return bookCollective(deps, booking, target.hosts);
    return claim(deps, booking, moving);
  };

  const openEntry: CalendarEntry | undefined = open === null ? undefined : state.entries.get(open.entryKey);
  const openOwn: EventEntry | null = openEntry === undefined || openEntry.source === 'inherited' ? null : openEntry;
  const openEvent: Event | null = openOwn === null ? null : openOwn.event;
  const changeable: EventEntry | null = openOwn !== null && changeableBy(openOwn, me, mayEditNode) ? openOwn : null;
  const role: BookingRole | null = openEvent === null ? null : bookingRole(openEvent, me);
  const cancelOpen = async (reason: string | null): Promise<string | null> => {
    if (role === null || openEvent === null) return 'this is not a booking you can cancel';
    try {
      if (role.kind === 'host') {
        const answer: IhttpMessage = await host.cancelAsHost(role.id, reason);
        return answer.status === 200 ? null : `it could not be cancelled (${answer.status})`;
      }
      if (client === null) return 'bookings cannot be changed from here right now';
      return await cancelAsBooker({ ports, engine, client, me, nowMs: nowOf(ports) }, openEvent, role.host, role.id, reason);
    } catch (e: unknown) {
      return reasonOf(e);
    }
  };
  const reschedule = async (id: string, bookedWith: string): Promise<void> => {
    const ack: Booking | null = await bookingAckOf(ports, engine, nodeId, bookedWith, id);
    if (ack === null) throw new Error(`${bookedWith} holds no booking ${id}`);
    setOpen(null);
    setPanel({ kind: 'book', moving: { id, host: bookedWith, typeId: ack.type_id } });
  };
  const cancelBooking = async (reason: string | null): Promise<string | null> => {
    const failed: string | null = await cancelOpen(reason);
    return failed === null ? null : `The booking was not cancelled: ${failed}.`;
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 p-[16px]" data-testid="calendar-pane">
      <SdkConsentPrompt consent={consent} />
      {panel.kind === 'none' && (
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button variant="outline" className="h-[44px]" onClick={(): void => setPanel({ kind: 'book', moving: null })}>Book with someone</Button>
          <Button variant="outline" className="h-[44px]" onClick={(): void => setPanel({ kind: 'setup' })}>Your booking page</Button>
          <Button variant="outline" className="h-[44px]" onClick={(): void => setPanel({ kind: 'polls' })}>Polls</Button>
          <Button variant="outline" className="h-[44px]" onClick={(): void => setPanel({ kind: 'apps' })}>Apps</Button>
          <Button variant="outline" className="h-[44px]" onClick={(): void => setPanel({ kind: 'notifications' })}>Notifications</Button>
        </div>
      )}
      {panel.kind !== 'none' && panel.kind !== 'new' && panel.kind !== 'edit' && (
        <Button variant="ghost" className="h-[44px] self-start" onClick={close}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to the calendar</span>
        </Button>
      )}
      {panel.kind === 'new' && (
        <EventEditor date={panel.date} reminders={panel.reminders} editing={null} node={node} above={above} nodeName={nodeName} me={me} displayZone={displayZone} engine={engine} newId={newId} nowMs={(): bigint => nowOf(ports)} onSave={saveEvent} onClose={close} />
      )}
      {panel.kind === 'edit' && (
        <EventEditor key={panel.entry.key} date={now.date} reminders={[]} editing={{ draft: draftOf(panel.entry.event, displayZone, engine, panel.entry.source), kept: panel.entry.source === 'node' ? 'node' : panel.entry.source === 'private' ? 'private' : 'authored' }}
          node={node} above={above} nodeName={nodeName} me={me} displayZone={displayZone} engine={engine} newId={(): string => panel.entry.event.id} nowMs={(): bigint => nowOf(ports)}
          onSave={(checked, progress): Promise<SaveOutcome> => saveRevision(ports, engine, panel.entry, checked, progress)} onClose={(): void => { setOpen(null); close(); }} />
      )}
      {panel.kind === 'setup' && <BookingSetup ports={ports} engine={engine} node={node} me={me} displayZone={displayZone} deviceZone={deviceZone} today={now.date} origin={window.location.origin} newId={newId} mayEditNode={mayEditNode} />}
      {panel.kind === 'apps' && <SdkAppsPanel ports={ports} engine={engine} />}
      {panel.kind === 'notifications' && (
        <section aria-labelledby="calendar-notifications-heading" className="flex min-w-0 max-w-2xl flex-col gap-3">
          <h2 id="calendar-notifications-heading" className="text-base font-semibold text-foreground">Notifications</h2>
          <CalendarNotifications ports={ports} />
        </section>
      )}
      {panel.kind === 'polls' && <PollsPanel ports={ports} engine={engine} node={node} me={me} displayZone={displayZone} firstDate={dateKey(now.date)} newId={newId} nowMs={(): bigint => nowOf(ports)} />}
      {panel.kind === 'book' && (
        <BookWith ports={ports} engine={engine} node={node} me={me} entries={state.entries} displayZone={displayZone} deviceZone={deviceZone}
          today={now.date} nowMs={nowMs} origin={window.location.origin} nodeName={nodeName} initial={panel.moving !== null ? { host: panel.moving.host, typeId: panel.moving.typeId } : linked === null ? null : { host: linked.host, typeId: linked.typeId }} onBook={book} />
      )}
      {(panel.kind === 'none' || panel.kind === 'new' || panel.kind === 'edit') && (
        <>
          {open !== null && panel.kind !== 'edit' && <EventDetails chip={open} displayZone={displayZone} nodeName={nodeName} onClose={(): void => setOpen(null)} onCancelBooking={role === null ? null : cancelBooking}
            onReschedule={role?.kind === 'booker' && client !== null ? (): void => { const { id, host: bookedWith } = role; reschedule(id, bookedWith).catch((e: unknown): void => { console.error('[calendar] the booking to move could not be read', e); }); } : null}
            onEdit={changeable === null ? null : (): void => setPanel({ kind: 'edit', entry: changeable })}
            onCancelEvent={changeable === null ? null : (reason: string | null): Promise<string | null> => cancelEvent(ports, engine, changeable, me, reason, nowOf(ports), nodeName)} />}
          <CalendarTab
            state={state} dispatch={dispatch} engine={engine} viewer={me} displayZone={displayZone}
            node={{ ...node, zone }} nodeName={nodeName} now={now} onOpenChip={setOpen}
            onCreate={create}
          />
        </>
      )}
    </div>
  );
}
