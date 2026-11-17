/**
 * A new poll (design §3.6.3): its title, which of the member's poll types it is and how long, and
 * the times proposed, typed in the member's zone and checked by `checkPollDraft` (poll-draft.ts)
 * before `onSave`. A member with no poll type is told where to add one.
 */
import { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { Poll } from '@/lib/calendar/generated/Poll';
import { checkPollDraft, type PollDraft, type ProposalDraft, type PollCheck } from '@/lib/calendar/poll-draft';
import { NativeSelect } from './NativeSelect';

interface PollComposerProps {
  id: string;
  me: string;
  zone: string;
  engine: CalendarEngine;
  /** The member's poll types on this node. */
  types: readonly EventType[];
  /** The first proposal's date, `yyyy-mm-dd`. */
  firstDate: string;
  onSave: (poll: Poll) => Promise<string | null>;
  onCancel: () => void;
}

export function PollComposer({ id, me, zone, engine, types, firstDate, onSave, onCancel }: PollComposerProps): JSX.Element {
  const base: string = useId();
  const first: EventType | undefined = types[0];
  const [draft, setDraft] = useState<PollDraft>({ title: first?.name ?? '', typeId: first?.id ?? null, durationMin: first?.durations_min[0] ?? null, proposals: [{ date: firstDate, time: '10:00' }] });
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [said, setSaid] = useState<string>('');
  const type: EventType | undefined = types.find((t: EventType) => t.id === draft.typeId);
  const setProposal = (i: number, next: ProposalDraft): void => setDraft({ ...draft, proposals: draft.proposals.map((p: ProposalDraft, j: number) => (j === i ? next : p)) });

  if (first === undefined) {
    return <p role="status" className="text-sm text-muted-foreground" data-testid="calendar-poll-composer">To ask people when they can meet, first add an event type of the kind “A poll of times you propose” on your booking page here.</p>;
  }
  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const checked: PollCheck = checkPollDraft(draft, { id, host: me, zone }, engine);
    if (!checked.ok) {
      setErrors(checked.errors);
      setSaid('Some fields need attention.');
      return;
    }
    setErrors(new Map());
    const failed: string | null = await onSave(checked.poll);
    setSaid(failed === null ? `Asked: ${checked.poll.title}.` : `Not saved: ${failed}.`);
  };
  const err = (key: string): JSX.Element | null => (errors.has(key) ? <p id={`${base}-${key}-error`} className="text-sm text-destructive-emphasis">{errors.get(key)}</p> : null);
  return (
    <form onSubmit={(e): void => { void save(e); }} aria-label="New poll" className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3" data-testid="calendar-poll-composer">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${base}-title`} className="text-sm font-medium text-foreground">Title</label>
        <Input id={`${base}-title`} className="h-[44px]" value={draft.title} aria-invalid={errors.has('title')} onChange={(e): void => setDraft({ ...draft, title: e.target.value })} />
        {err('title')}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-type`} className="text-sm font-medium text-foreground">Poll type</label>
          <NativeSelect id={`${base}-type`} className="w-full" value={draft.typeId ?? ''} onChange={(e): void => {
            const t: EventType | undefined = types.find((x: EventType) => x.id === e.target.value);
            setDraft({ ...draft, typeId: t?.id ?? null, durationMin: t?.durations_min[0] ?? null });
          }}>
            {types.map((t: EventType) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${base}-length`} className="text-sm font-medium text-foreground">Length</label>
          <NativeSelect id={`${base}-length`} className="w-full" value={String(draft.durationMin ?? '')} onChange={(e): void => setDraft({ ...draft, durationMin: Number(e.target.value) })}>
            {(type?.durations_min ?? []).map((d: number) => <option key={d} value={d}>{d} min</option>)}
          </NativeSelect>
        </div>
      </div>
      {err('type')}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Times to propose ({zone})</legend>
        {draft.proposals.map((p: ProposalDraft, i: number) => (
          <div key={i} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Input type="date" aria-label={`Time ${i + 1}: date`} className="h-[44px] w-[170px]" value={p.date} onChange={(e): void => setProposal(i, { ...p, date: e.target.value })} />
              <Input type="time" aria-label={`Time ${i + 1}: time`} className="h-[44px] w-[130px]" value={p.time} onChange={(e): void => setProposal(i, { ...p, time: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" className="h-[44px] w-[44px]" aria-label={`Remove time ${i + 1}`} disabled={draft.proposals.length === 1}
                onClick={(): void => setDraft({ ...draft, proposals: draft.proposals.filter((_, j: number) => j !== i) })}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {err(`proposal-${i}`)}
          </div>
        ))}
        <Button type="button" variant="outline" className="h-[44px] self-start" onClick={(): void => setDraft({ ...draft, proposals: [...draft.proposals, { date: draft.proposals.at(-1)?.date ?? firstDate, time: '' }] })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Add a time</span>
        </Button>
        {err('proposals')}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-[44px]">Ask</Button>
        <Button type="button" variant="outline" className="h-[44px]" onClick={onCancel}>Done</Button>
        <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
      </div>
    </form>
  );
}
