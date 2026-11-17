/**
 * The hours down the side of Week and Day. A second ruler, in the node's zone, sits beside the
 * member's when the two differ (design §3.4), each headed by its zone so neither is read by
 * position alone.
 */
import { formatHour, formatTimeIn } from '@/lib/calendar/format';

export const HOURS: number[] = Array.from({ length: 24 }, (_: unknown, h: number): number => h);

interface TimeRulerProps {
  /** The zone's short name, at the top. */
  heading: string;
  /** The instant each display-zone hour starts at, when this ruler is in another zone; null for the display zone's own ruler. */
  hourStarts: bigint[] | null;
  zone: string;
  hourClass: string;
  headClass: string;
}

export function TimeRuler({ heading, hourStarts, zone, hourClass, headClass }: TimeRulerProps): JSX.Element {
  return (
    <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border bg-background" aria-hidden="true" data-testid="calendar-time-ruler">
      <div className={`sticky top-0 z-10 flex items-end justify-end bg-background px-1 pb-1 text-xs font-medium text-muted-foreground ${headClass}`}>{heading}</div>
      {HOURS.map((h: number) => (
        <div key={h} className={`relative pr-1 text-right text-xs tabular-nums text-muted-foreground ${hourClass}`}>
          <span className="relative -top-2">{h === 0 ? '' : hourStarts === null ? formatHour(h) : formatTimeIn(hourStarts[h] as bigint, zone)}</span>
        </div>
      ))}
    </div>
  );
}
