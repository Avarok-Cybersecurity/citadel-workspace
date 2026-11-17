/**
 * The event editor (design §3.9 "New"): a title, the day, its hours or all day, where it happens,
 * who sees it, and whether it is posted under the member's name or made one of the node's own
 * events, checked by `checkEvent` (event-draft.ts) and written by `onSave`. Times are typed on
 * the member's display zone clock, which the form says. In the page's flow, above the grid.
 */
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { checkEvent, type EventCheck, type EventDraft } from '@/lib/calendar/event-draft';
import { dateKey } from '@/lib/calendar/grid-keyboard';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { Visibility } from '@/lib/calendar/generated/Visibility';
import type { SaveOutcome } from '@/lib/calendar/event-save';
import type { FanOutFailure } from '@/lib/calendar/fan-out';
import { NativeSelect } from './NativeSelect';
import { PropagationFields, type NamedNode } from './PropagationFields';
import { ReminderPicker } from './ReminderPicker';

/** An event being changed: its form read back (event-edit.ts) and the store it stays in. */
export interface Editing {
  readonly draft: EventDraft;
  readonly kept: 'node' | 'authored' | 'private';
}

interface EventEditorProps {
  date: CivilDate;
  /** The reminders a new event starts with (the member's notification settings); an edit keeps its own. */
  reminders: readonly number[];
  /** Null for a new event. */
  editing: Editing | null;
  node: { id: string; name: string };
  /** The pages above this one, nearest first, that an event can also be shown on. */
  above: readonly NamedNode[];
  nodeName: (id: string) => string;
  me: string;
  displayZone: string;
  engine: Pick<CalendarEngine, 'instantOf'>;
  newId: () => string;
  nowMs: () => bigint;
  /** Writes it; `progress` is told how many pages below have been brought in line. */
  onSave: (checked: Extract<EventCheck, { ok: true }>, progress: (done: number, of: number) => void) => Promise<SaveOutcome>;
  onClose: () => void;
}

const OPTION: string = 'flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';
const VISIBILITY: { value: Visibility; label: string }[] = [
  { value: 'public', label: 'Everyone on the page sees it' },
  { value: 'busy_only', label: 'Others see only that I am busy' },
  { value: 'private', label: 'Only me' },
];

function FieldError({ id, text }: { id: string; text: string | undefined }): JSX.Element | null {
  return text === undefined ? null : <p id={id} className="text-sm text-destructive-emphasis">{text}</p>;
}

function MissedPages({ missed, nodeName, onDone }: { missed: readonly FanOutFailure[]; nodeName: (id: string) => string; onDone: () => void }): JSX.Element {
  return (
    <div role="alert" className="flex min-w-0 flex-col gap-2 text-sm text-foreground" data-testid="calendar-fan-out-missed">
      <p>The event was saved, but it could not be shown on {missed.length === 1 ? 'one page' : `${missed.length} pages`} below:</p>
      <ul className="list-disc pl-5">{missed.map((m: FanOutFailure) => <li key={m.node} className="break-words">{nodeName(m.node)}: {m.reason}</li>)}</ul>
      <p className="text-muted-foreground">Saving it again tries those pages again.</p>
      <Button type="button" className="h-[44px] self-start" onClick={onDone}>Done</Button>
    </div>
  );
}

export function EventEditor({ date, reminders, editing, node, above, nodeName, me, displayZone, engine, newId, nowMs, onSave, onClose }: EventEditorProps): JSX.Element {
  const base: string = useId();
  const title: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<EventDraft>(editing?.draft ?? {
    title: '', notes: '', date, allDay: false, start: '09:00', end: '10:00', location: { kind: 'in_app' }, visibility: 'public', destination: 'authored', down: false, upTo: null, reminders,
  });
  // An edit keeps the event where it is stored: a private event stays private, a shared one shared.
  const choices: { value: Visibility; label: string; }[] = editing === null ? VISIBILITY : editing.kept === 'private' ? [] : VISIBILITY.filter((v) => v.value !== 'private');
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState<boolean>(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [missed, setMissed] = useState<readonly FanOutFailure[] | null>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const set = (patch: Partial<EventDraft>): void => setDraft({ ...draft, ...patch });
  const aria = (key: string): { 'aria-invalid': boolean; 'aria-describedby': string | undefined } => ({ 'aria-invalid': errors.has(key), 'aria-describedby': errors.has(key) ? `${base}-${key}-error` : undefined });

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const checked: EventCheck = checkEvent(draft, { id: newId(), node: node.id, me, zone: displayZone, nowMs: nowMs() }, engine);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors(new Map());
    setSaving(true);
    setFailed(null);
    const outcome: SaveOutcome = await onSave(checked, (done: number, of: number): void => setProgress({ done, of }));
    setSaving(false);
    setProgress(null);
    if (outcome.kind === 'saved') onClose();
    else if (outcome.kind === 'refused') setFailed(outcome.reason);
    else setMissed(outcome.failed);
  };

  return (
    <form onSubmit={(e): void => { void save(e); }} className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3" aria-label={editing === null ? 'New event' : 'Edit event'} data-testid="calendar-event-editor">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${base}-title`} className="text-sm font-medium text-foreground">Title</label>
        <Input id={`${base}-title`} ref={title} className="h-[44px]" value={draft.title} onChange={(e): void => set({ title: e.target.value })} {...aria('title')} />
        <FieldError id={`${base}-title-error`} text={errors.get('title')} />
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${base}-date`} className="text-sm font-medium text-foreground">Day</label>
          <Input id={`${base}-date`} type="date" className="h-[44px] w-[180px]" value={dateKey(draft.date)}
            onChange={(e): void => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (y !== undefined && m !== undefined && d !== undefined && !Number.isNaN(d)) set({ date: { y, m, d } });
            }} />
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.allDay} onChange={(e): void => set({ allDay: e.target.checked })} />
          All day
        </label>
        {!draft.allDay && (['start', 'end'] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1">
            <label htmlFor={`${base}-${k}`} className="text-sm font-medium text-foreground">{k === 'start' ? 'From' : 'To'}</label>
            <Input id={`${base}-${k}`} type="time" className="h-[44px] w-[120px]" value={draft[k]} onChange={(e): void => set({ [k]: e.target.value })} {...aria(k)} />
            <FieldError id={`${base}-${k}-error`} text={errors.get(k)} />
          </div>
        ))}
      </div>
      {!draft.allDay && <p className="text-xs text-muted-foreground">Times are in {displayZone}.</p>}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${base}-where`} className="text-sm font-medium text-foreground">Where</label>
        <NativeSelect id={`${base}-where`} className="w-full" value={draft.location.kind}
          onChange={(e): void => {
            const k: "in_app" | "in_person" | "text" = e.target.value as EventDraft['location']['kind'];
            set({ location: k === 'in_app' ? { kind: k } : k === 'in_person' ? { kind: k, address: '' } : { kind: k, text: '' } });
          }}>
          <option value="in_app">A call in the workspace</option>
          <option value="in_person">In person</option>
          <option value="text">Somewhere else</option>
        </NativeSelect>
        {draft.location.kind !== 'in_app' && (
          <Input aria-label={draft.location.kind === 'in_person' ? 'Address' : 'Where it is'} className="h-[44px]" {...aria('location')}
            value={draft.location.kind === 'in_person' ? draft.location.address : draft.location.text}
            onChange={(e): void => set({ location: draft.location.kind === 'in_person' ? { kind: 'in_person', address: e.target.value } : { kind: 'text', text: e.target.value } })} />
        )}
        <FieldError id={`${base}-location-error`} text={errors.get('location')} />
      </div>
      {choices.length > 0 && <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Who sees it</legend>
        {choices.map((v) => (
          <label key={v.value} className={OPTION}>
            <input type="radio" name={`${base}-vis`} className="h-4 w-4 accent-primary" checked={draft.visibility === v.value} onChange={(): void => set({ visibility: v.value })} />
            {v.label}
          </label>
        ))}
      </fieldset>}
      {draft.visibility !== 'private' && editing === null && (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-foreground">Post it as</legend>
          <label className={OPTION}>
            <input type="radio" name={`${base}-dest`} className="h-4 w-4 accent-primary" checked={draft.destination === 'authored'} onChange={(): void => set({ destination: 'authored' })} />
            Mine, on {node.name}
          </label>
          <label className={OPTION}>
            <input type="radio" name={`${base}-dest`} className="h-4 w-4 accent-primary" checked={draft.destination === 'node'} onChange={(): void => set({ destination: 'node' })} />
            One of {node.name}&apos;s own events (for its editors)
          </label>
        </fieldset>
      )}
      {draft.visibility !== 'private' && <PropagationFields draft={draft} nodeName={node.name} above={above} onChange={set} />}
      <ReminderPicker chosen={draft.reminders} onChange={(reminders: readonly number[]): void => set({ reminders })} />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${base}-notes`} className="text-sm font-medium text-foreground">Notes (optional)</label>
        <Textarea id={`${base}-notes`} rows={2} value={draft.notes} onChange={(e): void => set({ notes: e.target.value })} />
      </div>
      {failed !== null && <p role="alert" className="text-sm text-destructive-emphasis">The event was not saved: {failed}.</p>}
      {progress !== null && <p role="status" className="text-sm text-muted-foreground">Showing it on the pages below: {progress.done} of {progress.of}</p>}
      {missed !== null ? (
        <MissedPages missed={missed} nodeName={nodeName} onDone={onClose} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-[44px]" disabled={saving}>{saving ? 'Saving…' : editing === null ? 'Save event' : 'Save changes'}</Button>
          <Button type="button" variant="outline" className="h-[44px]" onClick={onClose}>Cancel</Button>
        </div>
      )}
    </form>
  );
}
