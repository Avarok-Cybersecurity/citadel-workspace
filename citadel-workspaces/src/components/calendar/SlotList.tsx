/**
 * The booking page's dates and times (design §3.9 "Booking page", §3.10): the days that have a
 * free slot, then that day's slots, each a real button whose name carries the full date, time and
 * zone. The days are a strip that wraps rather than a hover calendar, so every one is a 44px
 * target on a phone. Everything shown comes from `slotDays` (slot-list.ts), the core's answer.
 */
import { formatDayLong, formatDayShort, formatTimeIn, zoneAbbreviation } from '@/lib/calendar/format';
import { dateKey } from '@/lib/calendar/grid-keyboard';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { Interval } from '@/lib/calendar/generated/Interval';
import type { SlotDay } from '@/lib/calendar/slot-list';
import { cn } from '@/lib/utils';

interface SlotListProps {
  days: readonly SlotDay[];
  /** The zone the times are shown in. */
  zone: string;
  day: CivilDate | null;
  slot: Interval | null;
  onDay: (date: CivilDate) => void;
  onSlot: (slot: Interval) => void;
}

const CHOICE: string = cn(
  'min-h-[44px] min-w-[44px] rounded-md border px-3 text-sm font-medium',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);
const choiceState = (on: boolean): string => (on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted');

export const slotName = (slot: Interval, zone: string): string =>
  `${formatTimeIn(slot.start_ms, zone)} to ${formatTimeIn(slot.end_ms, zone)} ${zoneAbbreviation(zone, slot.start_ms)}`;

export function SlotList({ days, zone, day, slot, onDay, onSlot }: SlotListProps): JSX.Element {
  if (days.length === 0) {
    return <p role="status" className="text-sm text-muted-foreground" data-testid="calendar-no-slots">No times are free in this range. Try the next weeks, or another length.</p>;
  }
  const chosen: SlotDay | undefined = day === null ? undefined : days.find((d: SlotDay) => dateKey(d.date) === dateKey(day));
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="calendar-slot-list">
      <div role="group" aria-label="Days with free times" className="flex min-w-0 flex-wrap gap-2">
        {days.map((d: SlotDay) => {
          const on: boolean = chosen !== undefined && dateKey(chosen.date) === dateKey(d.date);
          return (
            <button key={dateKey(d.date)} type="button" aria-pressed={on} aria-label={`${formatDayLong(d.date)}, ${d.slots.length} free`} onClick={(): void => onDay(d.date)} className={cn(CHOICE, choiceState(on))}>
              {formatDayShort(d.date)}
            </button>
          );
        })}
      </div>
      {chosen === undefined ? (
        <p className="text-sm text-muted-foreground">Choose a day to see its times.</p>
      ) : (
        <div role="group" aria-label={`Free times on ${formatDayLong(chosen.date)}`} className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
          {chosen.slots.map((s: Interval) => {
            const on: boolean = slot !== null && slot.start_ms === s.start_ms && slot.end_ms === s.end_ms;
            return (
              <button
                key={s.start_ms.toString()}
                type="button"
                aria-pressed={on}
                aria-label={`${formatDayLong(chosen.date)}, ${slotName(s, zone)}`}
                onClick={(): void => onSlot(s)}
                className={cn(CHOICE, choiceState(on))}
                data-testid="calendar-slot"
              >
                {formatTimeIn(s.start_ms, zone)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
