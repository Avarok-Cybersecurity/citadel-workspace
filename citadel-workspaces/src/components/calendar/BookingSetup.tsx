/**
 * A member's own booking page on this node (design §3.6.1, §3.9): the link others follow to book
 * them (booking-link.ts), the hours they can be booked in, and the event types they offer, each
 * saved to their authored namespace on the node (booking-pages.ts), where a booker reads it.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useShareLauncher, type ShareLauncher } from '@/components/share/use-share-launcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { bookingLink } from '@/lib/calendar/booking-link';
import { readBookingPage, removeEventType, saveAvailability, saveEventType, type BookingPageData } from '@/lib/calendar/booking-pages';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { OWN_KINDS } from '@/lib/calendar/event-type-kind';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { EventType } from '@/lib/calendar/generated/EventType';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { AvailabilityEditor } from './AvailabilityEditor';
import { EventTypeEditor } from './EventTypeEditor';
import { RoutingFormsSetup } from './RoutingFormsSetup';
import { TeamTypesSetup } from './TeamTypesSetup';

interface BookingSetupProps {
  ports: CalendarPorts;
  engine: CalendarEngine;
  node: { id: string; name: string };
  me: string;
  displayZone: string;
  deviceZone: string;
  today: CivilDate;
  origin: string;
  newId: () => string;
  /** Whether the member edits this node, and so its team types too. */
  mayEditNode: boolean;
}

type Loaded = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; page: BookingPageData };
type Editing = { kind: 'none' } | { kind: 'type'; id: string; type: EventType | null };

const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');

export function BookingSetup({ ports, engine, node, me, displayZone, deviceZone, today, origin, newId, mayEditNode }: BookingSetupProps): JSX.Element {
  const linkId: string = useId();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [editing, setEditing] = useState<Editing>({ kind: 'none' });
  const [said, setSaid] = useState<string>('');
  const [scheduleId] = useState<string>(newId);
  const share: ShareLauncher = useShareLauncher();
  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setLoaded({ kind: 'ready', page: await readBookingPage(ports, engine, node.id, me) });
    } catch (e: unknown) {
      setLoaded({ kind: 'failed', reason: reasonOf(e) });
    }
  }, [ports, engine, node.id, me]);
  useEffect(() => { void reload(); }, [reload]);
  const saved = async (write: () => Promise<void>): Promise<string | null> => {
    try {
      await write();
      await reload();
      return null;
    } catch (e: unknown) {
      return reasonOf(e);
    }
  };
  const remove = async (type: EventType): Promise<void> => {
    const failed: string | null = await saved(() => removeEventType(ports, node.id, me, type.id));
    setSaid(failed === null ? `Removed ${type.name}.` : `${type.name} was not removed: ${failed}.`);
  };

  if (loaded.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading your booking page…</p>;
  if (loaded.kind === 'failed') return <p role="alert" className="text-sm text-destructive-emphasis">Your booking page could not be read: {loaded.reason}.</p>;
  const { page } = loaded;
  const link: string = bookingLink(origin, { node: node.id, host: me, typeId: null });
  return (
    <section aria-label={`Your booking page on ${node.name}`} className="flex min-w-0 flex-col gap-5" data-testid="calendar-booking-setup">
      <h2 className="text-base font-semibold text-foreground">Your booking page on {node.name}</h2>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={linkId} className="text-sm font-medium text-foreground">Link to book you (for members of {node.name})</label>
        <div className="flex min-w-0 gap-2">
          <Input id={linkId} readOnly value={link} className="h-[44px] min-w-0 flex-1" onFocus={(e): void => e.currentTarget.select()} />
          <Button type="button" variant="outline" className="h-[44px] shrink-0" onClick={(): void => {
            navigator.clipboard.writeText(link).then((): void => setSaid('Link copied.'), (): void => setSaid('The link could not be copied; select it and copy it instead.'));
          }}>Copy</Button>
        </div>
        <Button type="button" variant="outline" className="h-[44px] self-start" data-testid="calendar-share-booking-guests"
          onClick={(): void => share.open({ kind: 'booking-page', nodeId: node.id, host: me, nodeName: node.name })}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          <span>Invite guests from outside…</span>
        </Button>
        {share.dialog}
      </div>
      <section aria-label="Event types" className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">What people can book</h3>
        {page.types.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Add an event type so people can book you.</p>}
        <ul className="flex min-w-0 flex-col gap-1">
          {page.types.map((t: EventType) => (
            <li key={t.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3">
              <span className="min-w-0 flex-1 truncate py-2 text-sm text-foreground">{t.name} · {t.durations_min.map((d: number) => `${d} min`).join(', ')}</span>
              <Button type="button" variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" aria-label={`Edit ${t.name}`} onClick={(): void => setEditing({ kind: 'type', id: t.id, type: t })}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" aria-label={`Remove ${t.name}`} onClick={(): void => { void remove(t); }}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        {editing.kind === 'type' ? (
          <EventTypeEditor
            key={editing.id} id={editing.id} saved={editing.type} kinds={OWN_KINDS} members={[]} deviceZone={deviceZone} today={today} newId={newId}
            onSave={(type: EventType): Promise<string | null> => saved(() => saveEventType(ports, engine, node.id, me, type))}
            onCancel={(): void => setEditing({ kind: 'none' })}
          />
        ) : (
          <Button type="button" variant="outline" className="h-[44px] self-start" onClick={(): void => setEditing({ kind: 'type', id: newId(), type: null })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>New event type</span>
          </Button>
        )}
      </section>
      <section aria-label="Hours" className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">When you can be booked</h3>
        <AvailabilityEditor
          id={page.availability?.id ?? scheduleId} saved={page.availability} zone={displayZone} deviceZone={deviceZone}
          onSave={(availability): Promise<string | null> => saved(() => saveAvailability(ports, engine, node.id, me, availability))}
        />
      </section>
      {mayEditNode && <TeamTypesSetup ports={ports} engine={engine} node={node} deviceZone={deviceZone} today={today} newId={newId} />}
      {mayEditNode && <RoutingFormsSetup ports={ports} engine={engine} node={node} newId={newId} />}
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </section>
  );
}
