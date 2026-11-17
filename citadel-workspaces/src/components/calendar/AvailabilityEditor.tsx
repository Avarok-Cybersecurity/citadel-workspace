/**
 * The availability editor (design §3.9): the hours a member can be booked on each weekday, the
 * dates that differ, and the zone the hours are in, checked by `checkAvailability`
 * (availability-edit.ts) before `onSave`. A day with no hours reads "Unavailable" in words.
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { checkAvailability, draftOf, type AvailabilityDraft, type WindowText, type AvailabilityCheck } from '@/lib/calendar/availability-edit';
import { formatDayLong } from '@/lib/calendar/format';
import type { Availability } from '@/lib/calendar/generated/Availability';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import { dateKey } from '@/lib/calendar/grid-keyboard';
import { isKnownZone } from '@/lib/calendar/known-zones';
import { ZoneSelect } from './ZoneSelect';

const WEEKDAYS: readonly string[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WORKDAY: WindowText[] = [{ start: '09:00', end: '17:00' }];

/** What a new schedule starts as, shown to the member to edit: weekdays nine to five. */
export const starterSchedule = (zone: string): AvailabilityDraft => ({
  name: 'Working hours', zone, weekly: [WORKDAY, WORKDAY, WORKDAY, WORKDAY, WORKDAY, [], []], overrides: [],
});

interface AvailabilityEditorProps {
  id: string;
  saved: Availability | null;
  /** Where a new schedule's zone starts: the member's display zone. */
  zone: string;
  deviceZone: string;
  onSave: (availability: Availability) => Promise<string | null>;
}

const ICON: string = 'h-[44px] w-[44px] shrink-0';

function Windows({ label, windows, onChange, error }: { label: string; windows: WindowText[]; onChange: (next: WindowText[]) => void; error: string | undefined }): JSX.Element {
  const set = (i: number, w: WindowText): void => onChange(windows.map((x: WindowText, j: number) => (j === i ? w : x)));
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {windows.length === 0 && <span className="text-sm text-muted-foreground">Unavailable</span>}
        {windows.map((w: WindowText, i: number) => (
          <span key={i} className="flex items-center gap-1">
            <Input type="time" aria-label={`${label}, hours ${i + 1}, from`} className="h-[44px] w-[112px]" value={w.start} onChange={(e): void => set(i, { ...w, start: e.target.value })} />
            <span aria-hidden="true">–</span>
            <Input type="time" aria-label={`${label}, hours ${i + 1}, to`} className="h-[44px] w-[112px]" value={w.end} onChange={(e): void => set(i, { ...w, end: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" className={ICON} aria-label={`Remove ${label} hours ${i + 1}`} onClick={(): void => onChange(windows.filter((_x, j: number) => j !== i))}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        ))}
        <Button type="button" variant="ghost" size="icon" className={ICON} aria-label={`Add hours on ${label}`} onClick={(): void => onChange([...windows, { start: '09:00', end: '17:00' }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {error !== undefined && <p role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
    </div>
  );
}

function parseDate(text: string): CivilDate | null {
  const m: RegExpExecArray | null = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return m === null ? null : { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function AvailabilityEditor({ id, saved, zone, deviceZone, onSave }: AvailabilityEditorProps): JSX.Element {
  const [draft, setDraft] = useState<AvailabilityDraft>(saved === null ? starterSchedule(zone) : draftOf(saved));
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [newDate, setNewDate] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [said, setSaid] = useState<string>('');
  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const checked: AvailabilityCheck = checkAvailability(id, draft, isKnownZone);
    if (!checked.ok) {
      setErrors(checked.errors);
      setSaid('Some hours need attention.');
      return;
    }
    setErrors(new Map());
    setSaving(true);
    const failed: string | null = await onSave(checked.availability);
    setSaving(false);
    setSaid(failed === null ? 'Saved. Bookings use these hours from now on.' : `Not saved: ${failed}.`);
  };
  const addDate = (): void => {
    const date: CivilDate | null = parseDate(newDate);
    if (date === null) return;
    setDraft({ ...draft, overrides: [...draft.overrides, { date, windows: [] }] });
    setNewDate('');
  };
  return (
    <form onSubmit={(e): void => { void save(e); }} className="flex min-w-0 flex-col gap-4" data-testid="calendar-availability-editor" aria-label="Availability">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium text-foreground">Schedule name</label>
          <Input id={`${id}-name`} className="h-[44px]" value={draft.name} aria-invalid={errors.has('name')} onChange={(e): void => setDraft({ ...draft, name: e.target.value })} />
          {errors.has('name') && <p role="alert" className="text-sm text-destructive-emphasis">{errors.get('name')}</p>}
        </div>
        <ZoneSelect label="Hours are in" value={draft.zone} deviceZone={deviceZone} error={errors.get('zone')} onChange={(z: string): void => setDraft({ ...draft, zone: z })} />
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Weekly hours</legend>
        {WEEKDAYS.map((day: string, i: number) => (
          <div key={day} className="grid min-w-0 grid-cols-1 items-start gap-1 sm:grid-cols-[112px_1fr]">
            <span className="pt-3 text-sm font-medium text-foreground">{day}</span>
            <Windows label={day} windows={draft.weekly[i] ?? []} error={errors.get(`day-${i}`)} onChange={(next: WindowText[]): void => setDraft({ ...draft, weekly: draft.weekly.map((w, j) => (j === i ? next : w)) })} />
          </div>
        ))}
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Dates with other hours</legend>
        {draft.overrides.map((o, i: number) => (
          <div key={dateKey(o.date)} className="grid min-w-0 grid-cols-1 items-start gap-1 sm:grid-cols-[180px_1fr]">
            <span className="flex items-center gap-1 text-sm font-medium text-foreground">
              {formatDayLong(o.date)}
              <Button type="button" variant="ghost" size="icon" className={ICON} aria-label={`Use the weekly hours on ${formatDayLong(o.date)}`} onClick={(): void => setDraft({ ...draft, overrides: draft.overrides.filter((_x, j: number) => j !== i) })}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </span>
            <Windows label={formatDayLong(o.date)} windows={o.windows} error={errors.get(`date-${dateKey(o.date)}`)} onChange={(next: WindowText[]): void => setDraft({ ...draft, overrides: draft.overrides.map((x, j) => (j === i ? { ...x, windows: next } : x)) })} />
          </div>
        ))}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input type="date" aria-label="A date with other hours" className="h-[44px] w-[180px]" value={newDate} onChange={(e): void => setNewDate(e.target.value)} />
          <Button type="button" variant="outline" className="h-[44px]" disabled={parseDate(newDate) === null} onClick={addDate}>Add the date</Button>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-[44px]" disabled={saving}>{saving ? 'Saving…' : 'Save hours'}</Button>
        <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
      </div>
    </form>
  );
}
