/**
 * Agenda (design §3.9; the phone's first view): a month's events grouped by day, each a row that
 * prints its time, zone, title and where it comes from in text. The focused day is scrolled to,
 * and its first event takes focus when the member arrived here from a day in a grid.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { dateKey, sameDate } from '@/lib/calendar/grid-keyboard';
import { formatDayLong, formatMonth } from '@/lib/calendar/format';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { Chip, Placement } from '@/lib/calendar/placement';
import { EventChip } from './EventChip';

interface AgendaViewProps {
  days: CivilDate[];
  cursor: CivilDate;
  today: CivilDate;
  placement: Placement;
  displayZone: string;
  nodeName: (id: string) => string;
  /** Move focus to the cursor day's first event once drawn. */
  focusCursor: boolean;
  onOpenChip: (chip: Chip) => void;
  /** Null while no event can be made here: the empty state then offers nothing to press. */
  onCreate: ((date: CivilDate) => void) | null;
}

export function AgendaView({ days, cursor, today, placement, displayZone, nodeName, focusCursor, onOpenChip, onCreate }: AgendaViewProps): JSX.Element {
  const list: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const busy: CivilDate[] = days.filter((day: CivilDate) => (placement.days.get(dateKey(day)) ?? []).length > 0);
  const cursorKey: string = dateKey(cursor);

  useEffect((): void => {
    const section: HTMLElement | null | undefined = list.current?.querySelector<HTMLElement>(`[data-agenda-day="${cursorKey}"]`);
    section?.scrollIntoView({ block: 'start' });
    if (focusCursor) section?.querySelector<HTMLElement>('button')?.focus();
  }, [cursorKey, focusCursor]);

  if (busy.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={`Nothing scheduled in ${formatMonth(cursor)}`}
        description="Events posted on this page, and events from the pages above it, appear here."
        {...(onCreate === null ? {} : { action: { label: 'New event', onClick: (): void => onCreate(cursor) } })}
      />
    );
  }
  return (
    <div ref={list} className="flex min-w-0 flex-col gap-4" data-testid="calendar-agenda-view">
      {busy.map((day: CivilDate) => (
        <section key={dateKey(day)} data-agenda-day={dateKey(day)} aria-label={formatDayLong(day)} className="flex min-w-0 flex-col gap-1">
          <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-background py-1 text-sm font-semibold">
            {formatDayLong(day)}
            {sameDate(day, today) && <span className="rounded-sm bg-primary px-1.5 text-xs font-medium text-primary-foreground">Today</span>}
          </h3>
          <ul className="flex min-w-0 flex-col gap-1">
            {(placement.days.get(dateKey(day)) ?? []).map((chip: Chip) => (
              <li key={chip.id} className="min-w-0">
                <EventChip chip={chip} displayZone={displayZone} nodeName={nodeName} density="row" inGrid={false} onOpen={onOpenChip} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
