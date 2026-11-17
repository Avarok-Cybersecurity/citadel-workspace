/**
 * The node's routing forms (design §3.6.3), for its editors: each form to edit or remove, and a
 * new one. They are kept in the node's own store (routing-forms.ts), which only `EditMdx` holders
 * write; the kernel is the guard, and its refusal is said here. Bookers answer them on the node's
 * "Book with someone" page (RoutingAnswer).
 *
 * The forms and the team types they may route to are read when the setup mounts, and again when
 * the kernel says either changed on this node (it tells the writer's own session too), so a team
 * type added while the setup is open can be chosen at once.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isNodeKeyChange } from '@/lib/calendar/change-routing';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { RoutingForm } from '@/lib/calendar/generated/RoutingForm';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { TYPE_PREFIX } from '@/lib/calendar/booking-pages';
import { readRoutingForms, removeRoutingForm, ROUTING_PREFIX, saveRoutingForm } from '@/lib/calendar/routing-forms';
import { readTeamTypes } from '@/lib/calendar/team-types';
import type { Member } from '@/lib/citadel-apps/sdk/generated/Member';
import { RoutingFormEditor } from './RoutingFormEditor';

interface RoutingFormsSetupProps {
  ports: CalendarPorts;
  engine: CalendarEngine;
  node: { id: string; name: string };
  newId: () => string;
}

type Loaded = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; forms: RoutingForm[]; teams: EventType[]; members: string[] };
type Editing = { kind: 'none' } | { kind: 'form'; id: string; form: RoutingForm | null };

const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');
const ruleCount = (f: RoutingForm): string => (f.rules.length === 1 ? '1 rule' : `${f.rules.length} rules`);

export function RoutingFormsSetup({ ports, engine, node, newId }: RoutingFormsSetupProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [editing, setEditing] = useState<Editing>({ kind: 'none' });
  const [said, setSaid] = useState<string>('');
  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const [routing, team, members] = await Promise.all([readRoutingForms(ports, engine, node.id), readTeamTypes(ports, engine, node.id), ports.members()]);
      setLoaded({ kind: 'ready', forms: routing.forms, teams: team.types, members: members.map((m: Member) => m.username) });
    } catch (e: unknown) {
      setLoaded({ kind: 'failed', reason: reasonOf(e) });
    }
  }, [ports, engine, node.id]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => ports.onStorageChanged((change): void => {
    if (isNodeKeyChange(change, node.id, TYPE_PREFIX) || isNodeKeyChange(change, node.id, ROUTING_PREFIX)) void reload();
  }), [ports, node.id, reload]);
  const saved = async (write: () => Promise<void>): Promise<string | null> => {
    try {
      await write();
      await reload();
      return null;
    } catch (e: unknown) {
      return reasonOf(e);
    }
  };
  const remove = async (form: RoutingForm): Promise<void> => {
    const failed: string | null = await saved(() => removeRoutingForm(ports, node.id, form.id));
    if (failed === null && editing.kind === 'form' && editing.id === form.id) setEditing({ kind: 'none' });
    setSaid(failed === null ? `Removed ${form.name}.` : `${form.name} was not removed: ${failed}.`);
  };

  if (loaded.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading {node.name}&apos;s routing forms…</p>;
  if (loaded.kind === 'failed') return <p role="alert" className="text-sm text-destructive-emphasis">{node.name}&apos;s routing forms could not be read: {loaded.reason}.</p>;
  return (
    <section aria-label={`Routing forms on ${node.name}`} className="flex min-w-0 flex-col gap-2" data-testid="calendar-routing-forms">
      <h3 className="text-sm font-semibold text-foreground">Routing forms on {node.name}</h3>
      {loaded.forms.length === 0 && <p className="text-sm text-muted-foreground">None yet. A routing form asks a booker a few questions and sends them to whom they should book.</p>}
      <ul className="flex min-w-0 flex-col gap-1">
        {loaded.forms.map((f: RoutingForm) => (
          <li key={f.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3">
            <span className="min-w-0 flex-1 truncate py-2 text-sm text-foreground">{f.name} · {ruleCount(f)}</span>
            <Button type="button" variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" aria-label={`Edit ${f.name}`} onClick={(): void => setEditing({ kind: 'form', id: f.id, form: f })}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" aria-label={`Remove ${f.name}`} onClick={(): void => { void remove(f); }}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {editing.kind === 'form' ? (
        <RoutingFormEditor
          key={editing.id} engine={engine} id={editing.id} saved={editing.form} node={node} members={loaded.members} teams={loaded.teams} newId={newId}
          onSave={(form: RoutingForm): Promise<string | null> => saved(() => saveRoutingForm(ports, engine, node.id, form))}
          onCancel={(): void => setEditing({ kind: 'none' })}
        />
      ) : (
        <Button type="button" variant="outline" className="h-[44px] self-start" onClick={(): void => setEditing({ kind: 'form', id: newId(), form: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>New routing form</span>
        </Button>
      )}
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </section>
  );
}
