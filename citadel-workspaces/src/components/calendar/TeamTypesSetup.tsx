/**
 * The node's team types (design §3.6.2), for its editors: each round robin or collective with its
 * hosts, to edit or remove, and a new one. They are kept in the node's own store (team-types.ts),
 * which only `EditMdx` holders write; the kernel is the guard, and its refusal is said here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { TEAM_KINDS } from '@/lib/calendar/event-type-kind';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { EventType } from '@/lib/calendar/generated/EventType';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { readTeamTypes, removeTeamType, saveTeamType, teamHosts } from '@/lib/calendar/team-types';
import type { Member } from '@/lib/citadel-apps/sdk/generated/Member';
import { EventTypeEditor } from './EventTypeEditor';

interface TeamTypesSetupProps {
  ports: CalendarPorts;
  engine: CalendarEngine;
  node: { id: string; name: string };
  deviceZone: string;
  today: CivilDate;
  newId: () => string;
}

type Loaded = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; types: EventType[]; members: string[] };
type Editing = { kind: 'none' } | { kind: 'type'; id: string; type: EventType | null };

const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');
const kindName = (t: EventType): string => (typeof t.kind === 'object' && 'collective' in t.kind ? 'all together' : 'in turn');

export function TeamTypesSetup({ ports, engine, node, deviceZone, today, newId }: TeamTypesSetupProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [editing, setEditing] = useState<Editing>({ kind: 'none' });
  const [said, setSaid] = useState<string>('');
  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const [team, members] = await Promise.all([readTeamTypes(ports, engine, node.id), ports.members()]);
      setLoaded({ kind: 'ready', types: team.types, members: members.map((m: Member) => m.username) });
    } catch (e: unknown) {
      setLoaded({ kind: 'failed', reason: reasonOf(e) });
    }
  }, [ports, engine, node.id]);
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
    const failed: string | null = await saved(() => removeTeamType(ports, node.id, type.id));
    setSaid(failed === null ? `Removed ${type.name}.` : `${type.name} was not removed: ${failed}.`);
  };

  if (loaded.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading {node.name}&apos;s team types…</p>;
  if (loaded.kind === 'failed') return <p role="alert" className="text-sm text-destructive-emphasis">{node.name}&apos;s team types could not be read: {loaded.reason}.</p>;
  return (
    <section aria-label={`Team event types on ${node.name}`} className="flex min-w-0 flex-col gap-2" data-testid="calendar-team-types">
      <h3 className="text-sm font-semibold text-foreground">Team event types on {node.name}</h3>
      {loaded.types.length === 0 && <p className="text-sm text-muted-foreground">None yet. A team type is booked with one of its hosts in turn, or with all of them together.</p>}
      <ul className="flex min-w-0 flex-col gap-1">
        {loaded.types.map((t: EventType) => (
          <li key={t.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3">
            <span className="min-w-0 flex-1 truncate py-2 text-sm text-foreground">{t.name} · {kindName(t)} · {(teamHosts(t) ?? []).join(', ')}</span>
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
          key={editing.id} id={editing.id} saved={editing.type} kinds={TEAM_KINDS} members={loaded.members} deviceZone={deviceZone} today={today} newId={newId}
          onSave={(type: EventType): Promise<string | null> => saved(() => saveTeamType(ports, engine, node.id, type))}
          onCancel={(): void => setEditing({ kind: 'none' })}
        />
      ) : (
        <Button type="button" variant="outline" className="h-[44px] self-start" onClick={(): void => setEditing({ kind: 'type', id: newId(), type: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>New team type</span>
        </Button>
      )}
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </section>
  );
}
