/**
 * The event-type editor (design §3.1, §3.6.2, §3.9): what a member, or a team on the node, offers
 * to be booked for: who books a slot (one person, a group, a poll; or one of a team's hosts, or all
 * of them together, TeamKindFields), its lengths,
 * its booking rules (buffers, notice, a daily limit, how often slots start, how far ahead) and its
 * questions, checked by `checkEventType` (event-type-form.ts) before `onSave`. Each rule's field
 * says its unit in its label; each error sits under its field.
 */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { isTeamKind, type EditableKind, type KindChoice } from '@/lib/calendar/event-type-kind';
import { checkEventType, COLOR_TOKENS, eventTypeDraft, type EventTypeDraft, type RangeDraft, type EventTypeCheck } from '@/lib/calendar/event-type-form';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { ColorToken } from '@/lib/calendar/generated/ColorToken';
import type { EventType } from '@/lib/calendar/generated/EventType';
import { isKnownZone } from '@/lib/calendar/known-zones';
import { QuestionsEditor } from './QuestionsEditor';
import { TeamKindFields } from './TeamKindFields';
import { ZoneSelect } from './ZoneSelect';

/** What a new type of `kind` starts as, shown to the member to edit. */
export const starterType = (kind: EditableKind): EventTypeDraft => ({
  name: '', kind, seats: '', hosts: [], strategy: 'equal', weights: {}, durations: '30', bufferBefore: '0', bufferAfter: '0', minNoticeHours: '4', maxPerDay: '',
  increment: '30', range: { kind: 'rolling', days: '30' }, cancelPolicy: '', questions: [], color: 'primary', zoneLock: null,
});

const COLOR_LABEL: Record<ColorToken, string> = {
  primary: 'Primary', success: 'Green', warning: 'Amber', destructive_emphasis: 'Red', accent: 'Accent', secondary: 'Grey',
};
const SWATCH: Record<ColorToken, string> = {
  primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', destructive_emphasis: 'bg-destructive-emphasis', accent: 'bg-accent', secondary: 'bg-secondary',
};

const KIND_LABEL: Record<EditableKind, string> = {
  one_on_one: 'One person', group: 'A group', poll: 'A poll of times you propose',
  round_robin: 'One of several hosts, in turn', collective: 'All the hosts together',
};

interface EventTypeEditorProps {
  id: string;
  saved: EventType | null;
  /** The kinds offered: a member's own, or a team's; a new type starts as the first. */
  kinds: KindChoice;
  /** Who may host a team's type: the node's members. */
  members: readonly string[];
  deviceZone: string;
  /** Where a range between two dates starts. */
  today: CivilDate;
  newId: () => string;
  onSave: (type: EventType) => Promise<string | null>;
  onCancel: () => void;
}

type TextKey = 'name' | 'seats' | 'durations' | 'bufferBefore' | 'bufferAfter' | 'minNoticeHours' | 'maxPerDay' | 'increment';

export function EventTypeEditor({ id, saved, kinds, members, deviceZone, today, newId, onSave, onCancel }: EventTypeEditorProps): JSX.Element {
  const base: string = useId();
  const [draft, setDraft] = useState<EventTypeDraft>(saved === null ? starterType(kinds[0]) : eventTypeDraft(saved));
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState<boolean>(false);
  const [said, setSaid] = useState<string>('');
  const errorKey = (key: TextKey): string => (key === 'minNoticeHours' ? 'minNotice' : key);

  const text = (key: TextKey, label: string, inputMode: 'text' | 'numeric' = 'numeric'): JSX.Element => {
    const fid: string = `${base}-${key}`;
    const error: string | undefined = errors.get(errorKey(key));
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={fid} className="text-sm font-medium text-foreground">{label}</label>
        <Input id={fid} inputMode={inputMode} className="h-[44px]" value={draft[key]} aria-invalid={error !== undefined} aria-describedby={error === undefined ? undefined : `${fid}-error`}
          onChange={(e): void => setDraft({ ...draft, [key]: e.target.value })} />
        {error !== undefined && <p id={`${fid}-error`} className="text-sm text-destructive-emphasis">{error}</p>}
      </div>
    );
  };
  const setRange = (kind: RangeDraft['kind']): void => {
    setDraft({ ...draft, range: kind === 'indefinite' ? { kind } : kind === 'rolling' ? { kind, days: '30' } : { kind, from: today, to: today } });
  };
  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const checked: EventTypeCheck = checkEventType(id, draft, isKnownZone);
    if (!checked.ok) {
      setErrors(checked.errors);
      setSaid('Some fields need attention.');
      return;
    }
    setErrors(new Map());
    setSaving(true);
    const failed: string | null = await onSave(checked.type);
    setSaving(false);
    setSaid(failed === null ? `Saved ${checked.type.name}.` : `Not saved: ${failed}.`);
  };

  return (
    <form onSubmit={(e): void => { void save(e); }} className="flex min-w-0 flex-col gap-4" data-testid="calendar-event-type-editor" aria-label={saved === null ? 'New event type' : `Edit ${saved.name}`}>
      {text('name', 'Name', 'text')}
      <fieldset className="flex min-w-0 flex-wrap gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Who books a slot</legend>
        {kinds.map((k: EditableKind) => (
          <label key={k} className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input type="radio" name={`${base}-kind`} className="h-4 w-4 accent-primary" checked={draft.kind === k} onChange={(): void => setDraft({ ...draft, kind: k, seats: k === 'group' && draft.seats === '' ? '10' : draft.seats })} />
            {KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      {isTeamKind(draft.kind) && <TeamKindFields draft={draft} members={members} errors={errors} onChange={(kind): void => setDraft({ ...draft, ...kind })} />}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {draft.kind === 'group' && text('seats', 'Seats per slot')}
        {text('durations', 'Lengths, in minutes (for example 30, 60)', 'text')}
        {text('bufferBefore', 'Free time before, in minutes')}
        {text('bufferAfter', 'Free time after, in minutes')}
        {text('minNoticeHours', 'Minimum notice, in hours')}
        {text('maxPerDay', 'Most bookings a day (empty for no limit)')}
        {text('increment', 'Slots start every, in minutes')}
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">How far ahead</legend>
        <div className="flex min-w-0 flex-wrap gap-2">
          {(['rolling', 'fixed', 'indefinite'] as const).map((k) => (
            <label key={k} className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="radio" name={`${base}-range`} className="h-4 w-4 accent-primary" checked={draft.range.kind === k} onChange={(): void => setRange(k)} />
              {k === 'rolling' ? 'A number of days' : k === 'fixed' ? 'Between two dates' : 'Any time ahead'}
            </label>
          ))}
        </div>
        {draft.range.kind === 'rolling' && (
          <Input aria-label="Days ahead" inputMode="numeric" className="h-[44px] w-[120px]" value={draft.range.days} onChange={(e): void => setDraft({ ...draft, range: { kind: 'rolling', days: e.target.value } })} />
        )}
        {draft.range.kind === 'fixed' && (
          <div className="flex flex-wrap gap-2">
            {(['from', 'to'] as const).map((end) => {
              const r: { kind: "fixed"; from: CivilDate; to: CivilDate; } = draft.range as Extract<RangeDraft, { kind: 'fixed' }>;
              const v: CivilDate = r[end];
              return (
                <Input key={end} type="date" aria-label={end === 'from' ? 'First date' : 'Last date'} className="h-[44px] w-[180px]" value={`${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`}
                  onChange={(e): void => {
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    if (y !== undefined && m !== undefined && d !== undefined && !Number.isNaN(d)) setDraft({ ...draft, range: { ...r, [end]: { y, m, d } } });
                  }} />
              );
            })}
          </div>
        )}
        {errors.has('range') && <p role="alert" className="text-sm text-destructive-emphasis">{errors.get('range')}</p>}
      </fieldset>
      <div className="flex min-w-0 flex-col gap-2">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.zoneLock !== null} onChange={(e): void => setDraft({ ...draft, zoneLock: e.target.checked ? deviceZone : null })} />
          Always show times in one zone
        </label>
        {draft.zoneLock !== null && <ZoneSelect label="Zone" value={draft.zoneLock} deviceZone={deviceZone} error={errors.get('zoneLock')} onChange={(z: string): void => setDraft({ ...draft, zoneLock: z })} />}
      </div>
      <fieldset className="flex min-w-0 flex-wrap gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Colour</legend>
        {COLOR_TOKENS.map((c: ColorToken) => (
          <label key={c} className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input type="radio" name={`${base}-color`} className="sr-only" checked={draft.color === c} onChange={(): void => setDraft({ ...draft, color: c })} />
            <span aria-hidden="true" className={`h-4 w-4 rounded-full ${SWATCH[c]}`} />
            {COLOR_LABEL[c]}
          </label>
        ))}
      </fieldset>
      <QuestionsEditor questions={draft.questions} errors={errors} newId={newId} onChange={(questions): void => setDraft({ ...draft, questions })} />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${base}-cancel`} className="text-sm font-medium text-foreground">Cancellation policy (optional)</label>
        <Textarea id={`${base}-cancel`} rows={2} value={draft.cancelPolicy} onChange={(e): void => setDraft({ ...draft, cancelPolicy: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-[44px]" disabled={saving}>{saving ? 'Saving…' : 'Save event type'}</Button>
        <Button type="button" variant="outline" className="h-[44px]" onClick={onCancel}>Done</Button>
        <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
      </div>
    </form>
  );
}
