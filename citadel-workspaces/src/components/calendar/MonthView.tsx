/**
 * Month (design §3.9): whole weeks, Monday first. On a desktop each day lists its first events and
 * "+N more", which opens the day in Agenda (never a hover popover); on a phone a day shows dots,
 * and a tap opens it. The grid is one tab stop with the keys of design §3.10.
 */
import { cn } from '@/lib/utils';
import { dateKey, sameDate, type GridNav } from '@/lib/calendar/grid-keyboard';
import { formatDayLong, formatWeekday } from '@/lib/calendar/format';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { Chip, Placement } from '@/lib/calendar/placement';
import { EventChip } from './EventChip';
import { useRovingGrid, type GridHandlers } from './use-roving-grid';
import type { DayCell, RovingGrid } from '@/components/calendar/use-roving-grid';

/** Chips a desktop day lists before "+N more". */
const SHOWN_PER_DAY: number = 3;
const DOTS_PER_DAY: number = 3;

interface MonthViewProps extends GridHandlers {
  days: CivilDate[];
  cursor: CivilDate;
  today: CivilDate;
  placement: Placement;
  displayZone: string;
  nodeName: (id: string) => string;
  nav: GridNav;
  onOpenChip: (chip: Chip) => void;
  /** "+N more": the day in Agenda. */
  onMore: (date: CivilDate) => void;
}

const counted = (n: number): string => (n === 0 ? 'no events' : n === 1 ? '1 event' : `${n} events`);

function weeksOf(days: CivilDate[]): CivilDate[][] {
  const weeks: CivilDate[][] = [];
  for (let i: number = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export function MonthView(props: MonthViewProps): JSX.Element {
  const { days, cursor, today, placement, displayZone, nodeName, nav, onOpenChip, onMore } = props;
  const grid: RovingGrid = useRovingGrid(cursor, 'month', nav, props);
  const firstWeek: CivilDate[] = days.slice(0, 7);
  return (
    <div
      ref={grid.gridRef}
      role="grid"
      aria-label="Month"
      data-testid="calendar-month-grid"
      className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border"
    >
      <div role="row" className="grid grid-cols-7 border-b border-border bg-muted/50">
        {firstWeek.map((day: CivilDate) => (
          <div key={dateKey(day)} role="columnheader" className="px-1 py-1.5 text-center text-xs font-medium text-muted-foreground sm:text-left sm:px-2">
            {formatWeekday(day)}
          </div>
        ))}
      </div>
      {weeksOf(days).map((week: CivilDate[]) => (
        <div key={dateKey(week[0] as CivilDate)} role="row" className="grid grid-cols-7 border-b border-border last:border-b-0">
          {week.map((day: CivilDate) => {
            const chips: Chip[] = placement.days.get(dateKey(day)) ?? [];
            const outside: boolean = day.m !== cursor.m;
            const isToday: boolean = sameDate(day, today);
            const hidden: number = Math.max(0, chips.length - SHOWN_PER_DAY);
            const cell: DayCell = grid.cell(day);
            return (
              <div
                key={cell.key}
                role="gridcell"
                tabIndex={cell.tabIndex}
                data-date={cell.key}
                aria-selected={cell.selected}
                onFocus={cell.onFocus}
                onKeyDown={cell.onKeyDown}
                onClick={(): void => props.onOpenDay(day)}
                aria-label={`${formatDayLong(day)}, ${counted(chips.length)}`}
                aria-current={isToday ? 'date' : undefined}
                data-testid="calendar-day-cell"
                className={cn(
                  'flex min-h-[64px] min-w-0 cursor-pointer flex-col gap-0.5 border-r border-border p-1 last:border-r-0 sm:min-h-[104px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  outside && 'bg-muted/30 text-muted-foreground',
                  sameDate(day, cursor) && 'bg-accent',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center self-center rounded-full text-xs tabular-nums sm:self-start',
                    isToday && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {day.d}
                </span>
                <span className="flex justify-center gap-1 sm:hidden" aria-hidden="true" data-testid="calendar-day-dots">
                  {chips.slice(0, DOTS_PER_DAY).map((chip: Chip) => (
                    <span key={chip.id} className={cn('h-1.5 w-1.5 rounded-full', chip.origin === 'own' ? 'bg-primary' : 'bg-muted-foreground')} />
                  ))}
                </span>
                <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                  {chips.slice(0, SHOWN_PER_DAY).map((chip: Chip) => (
                    <EventChip key={chip.id} chip={chip} displayZone={displayZone} nodeName={nodeName} density="cell" inGrid onOpen={onOpenChip} />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e: React.MouseEvent): void => {
                        e.stopPropagation();
                        onMore(day);
                      }}
                      className="rounded-sm px-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      +{hidden} more
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
