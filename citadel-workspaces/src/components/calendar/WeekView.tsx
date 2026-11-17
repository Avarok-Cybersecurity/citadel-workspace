/**
 * Week and Day (design §3.9): one column per day on the member's clock, 24 hours, chips placed by
 * time and laned when they overlap, all-day events in a strip above, a "now" line, and a second
 * ruler for the node's zone when it differs. On a phone each day is the pane's width and the days
 * snap sideways. The days are one tab stop (design §3.10); Enter opens the day in Agenda, where each
 * event is its own button, so the chips here are pointer targets the keyboard reaches there.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { dateKey, sameDate, type GridNav } from '@/lib/calendar/grid-keyboard';
import { formatDayLong, formatDayShort, zoneAbbreviation } from '@/lib/calendar/format';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { CivilDateTime } from '@/lib/calendar/generated/CivilDateTime';
import { layoutLanes, type Laned } from '@/lib/calendar/lanes';
import type { Chip, Placement } from '@/lib/calendar/placement';
import { EventChip } from './EventChip';
import { HOURS, TimeRuler } from './TimeRuler';
import { useRovingGrid, type GridHandlers } from './use-roving-grid';
import type { DayCell, RovingGrid } from '@/components/calendar/use-roving-grid';

/** One hour's height: tall enough on a phone that a half-hour event is a 44px target. */
const HOUR_CLASS: string = 'h-[96px] sm:h-[48px]';
/** The day's label and its all-day events: one 44px row on a phone, two compact rows on a desktop. */
const HEAD_CLASS: string = 'h-[84px] sm:h-[100px]';
const SCROLL_TO_HOUR: number = 8;
const ALL_DAY_SHOWN: { phone: number; desktop: number } = { phone: 1, desktop: 2 };

interface WeekViewProps extends GridHandlers {
  view: 'week' | 'day';
  days: CivilDate[];
  cursor: CivilDate;
  today: CivilDate;
  now: CivilDateTime;
  placement: Placement;
  displayZone: string;
  /** The node's zone and the instant each display hour of the first day starts at, when the zones differ. */
  nodeRuler: { zone: string; hourStarts: bigint[] } | null;
  nodeName: (id: string) => string;
  nav: GridNav;
  onOpenChip: (chip: Chip) => void;
  onMore: (date: CivilDate) => void;
}

function Column({ chips, isToday, now, props }: { chips: Chip[]; isToday: boolean; now: CivilDateTime; props: WeekViewProps }): JSX.Element {
  const timed: Laned<{ chip: Chip; fromMinute: number; toMinute: number; }>[] = layoutLanes(chips.flatMap((chip: Chip) => (chip.span.kind === 'timed' ? [{ chip, fromMinute: chip.span.fromMinute, toMinute: chip.span.toMinute }] : [])));
  return (
    <div className="relative">
      {HOURS.map((h: number) => <div key={h} className={cn('border-b border-dashed border-border/70', HOUR_CLASS)} />)}
      {timed.map(({ item, lane, lanes }) => (
        <EventChip
          key={item.chip.id}
          chip={item.chip}
          displayZone={props.displayZone}
          nodeName={props.nodeName}
          density="column"
          inGrid
          onOpen={props.onOpenChip}
          className="absolute min-h-[44px] sm:min-h-[20px]"
          style={{
            top: `${(item.fromMinute / 1440) * 100}%`,
            height: `${((item.toMinute - item.fromMinute) / 1440) * 100}%`,
            left: `calc(${(lane / lanes) * 100}% + 2px)`,
            width: `calc(${100 / lanes}% - 4px)`,
          }}
        />
      ))}
      {isToday && (
        <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive" style={{ top: `${(now.minute / 1440) * 100}%` }} data-testid="calendar-now-line">
          <span className="sr-only">Now</span>
        </div>
      )}
    </div>
  );
}

/** A day's all-day events: as many as fit, then "+N more", which opens the day in Agenda. */
function AllDay({ chips, shown, className, day, props }: { chips: Chip[]; shown: number; className: string; day: CivilDate; props: WeekViewProps }): JSX.Element {
  const extra: number = chips.length > shown ? chips.length - shown + 1 : 0;
  return (
    <div className={cn('min-w-0 flex-col gap-1', className)}>
      {chips.slice(0, extra > 0 ? shown - 1 : shown).map((chip: Chip) => (
        <EventChip key={chip.id} chip={chip} displayZone={props.displayZone} nodeName={props.nodeName} density="cell" inGrid onOpen={props.onOpenChip} className="min-h-[44px] sm:min-h-0" />
      ))}
      {extra > 0 && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e: React.MouseEvent): void => {
            e.stopPropagation();
            props.onMore(day);
          }}
          className="min-h-[44px] rounded-sm px-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[24px]"
        >
          +{extra} more all day
        </button>
      )}
    </div>
  );
}

export function WeekView(props: WeekViewProps): JSX.Element {
  const { view, days, cursor, today, now, placement, displayZone, nodeRuler, nav } = props;
  const grid: RovingGrid = useRovingGrid(cursor, view, nav, props);
  const scroller: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const first: CivilDate = days[0] as CivilDate;

  useEffect((): void => {
    const el: HTMLDivElement | null = scroller.current;
    const hour: HTMLElement | null | undefined = el?.querySelector<HTMLElement>('[data-testid="calendar-time-ruler"] > div:nth-child(2)');
    if (el && hour) el.scrollTop = hour.offsetHeight * SCROLL_TO_HOUR;
  }, []);

  return (
    <div ref={scroller} className="relative flex max-h-[70vh] min-w-0 snap-x snap-mandatory overflow-auto scroll-pl-14 rounded-md border border-border [container-type:inline-size] sm:snap-none" data-testid={`calendar-${view}-view`}>
      <TimeRuler heading={zoneAbbreviation(displayZone, placement.fromMs)} hourStarts={null} zone={displayZone} hourClass={HOUR_CLASS} headClass={HEAD_CLASS} />
      {nodeRuler !== null && <TimeRuler heading={zoneAbbreviation(nodeRuler.zone, placement.fromMs)} hourStarts={nodeRuler.hourStarts} zone={nodeRuler.zone} hourClass={HOUR_CLASS} headClass={HEAD_CLASS} />}
      <div ref={grid.gridRef} role="grid" aria-label={view === 'week' ? 'Week' : 'Day'} className="flex min-w-0 flex-1">
        <div role="row" className="flex min-w-0 flex-1">
          {days.map((day: CivilDate) => {
            const chips: Chip[] = placement.days.get(dateKey(day)) ?? [];
            const allDay: Chip[] = chips.filter((c: Chip) => c.span.kind === 'all_day');
            const isToday: boolean = sameDate(day, today);
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
                aria-label={formatDayLong(day)}
                aria-current={isToday ? 'date' : undefined}
                data-testid="calendar-day-column"
                className={cn(
                  'min-w-[calc(100cqw-56px)] flex-1 snap-start border-r border-border last:border-r-0 sm:min-w-[96px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  view === 'day' && 'sm:min-w-0',
                )}
              >
                <div className={cn('sticky top-0 z-10 flex flex-col gap-1 border-b border-border bg-background p-1', HEAD_CLASS)}>
                  <span className={cn('self-start rounded-sm px-1 text-sm font-medium', isToday && 'bg-primary text-primary-foreground')}>{formatDayShort(day)}</span>
                  <AllDay chips={allDay} shown={ALL_DAY_SHOWN.phone} className="flex sm:hidden" day={day} props={props} />
                  <AllDay chips={allDay} shown={ALL_DAY_SHOWN.desktop} className="hidden sm:flex" day={day} props={props} />
                </div>
                <Column chips={chips} isToday={isToday} now={now} props={props} />
              </div>
            );
          })}
        </div>
      </div>
      <span className="sr-only">{`Showing ${days.length === 1 ? formatDayLong(first) : `the week of ${formatDayLong(first)}`}`}</span>
    </div>
  );
}
