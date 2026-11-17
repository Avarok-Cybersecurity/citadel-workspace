/**
 * When the member is reminded of an event they make (design §3.7, §3.10): a few offsets to tick,
 * and, in words, the interim limitation until Signals timers ship: a reminder fires only while one
 * of their workspace windows is open, and one missed while none was is listed once on return.
 */
import { useId } from 'react';
import { LEAD_CHOICES, leadLabel } from '@/lib/calendar/notify-prefs';


interface ReminderPickerProps {
  chosen: readonly number[];
  onChange: (chosen: readonly number[]) => void;
}

export function ReminderPicker({ chosen, onChange }: ReminderPickerProps): JSX.Element {
  const help: string = useId();
  const offered: number[] = [...new Set([...LEAD_CHOICES, ...chosen])].sort((a: number, b: number) => a - b);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={help}>
      <legend className="mb-1 text-sm font-semibold text-foreground">Remind me</legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {offered.map((m: number) => (
          <label key={m} className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={chosen.includes(m)}
              onChange={(e): void => onChange(e.target.checked ? [...chosen, m] : chosen.filter((c: number) => c !== m))} />
            {leadLabel(m)}
          </label>
        ))}
      </div>
      <p id={help} className="text-sm text-muted-foreground">
        A reminder arrives while one of your workspace windows is open, whichever page it shows. One that falls due while none is open is listed once in your notifications when you come back.
      </p>
    </fieldset>
  );
}
