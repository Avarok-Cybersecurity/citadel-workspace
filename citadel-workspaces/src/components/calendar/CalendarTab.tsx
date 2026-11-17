/**
 * The Calendar as a node's tab (design §3.9): the toolbar, what could not be shown, and the view
 * the store names, every day and time derived from the core through the engine. It reads no port
 * and no clock: the mount hands it the store, the engine, the member and node zones, and today.
 */
import { useCallback, useMemo, useState } from 'react';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { formatDayLong, formatDayShort, formatMonth, zoneAbbreviation } from '@/lib/calendar/format';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { CivilDateTime } from '@/lib/calendar/generated/CivilDateTime';
import { place, type Chip, type Placement } from '@/lib/calendar/placement';
import type { CalendarAction, CalendarState, CalendarView } from '@/lib/calendar/store';
import { AgendaView } from './AgendaView';
import { CalendarNotices } from './CalendarNotices';
import { CalendarToolbar } from './CalendarToolbar';
import { MonthView } from './MonthView';
import { HOURS } from './TimeRuler';
import { WeekView } from './WeekView';

export interface CalendarTabProps {
  state: CalendarState;
  dispatch: (action: CalendarAction) => void;
  engine: CalendarEngine;
  /** The member reading: whose busy-only events show their titles. */
  viewer: string;
  /** The member's display zone (design §3.4), already chosen. */
  displayZone: string;
  /** `zone` null: neither the node, its ancestors nor the workspace names one, and the pane says so. */
  node: { id: string; name: string; zone: string | null };
  nodeName: (id: string) => string;
  /** The current day and minute on the display zone's clock. */
  now: CivilDateTime;
  onOpenChip: (chip: Chip) => void;
  /** Null while no event can be made here (no editor yet, or no right to post). */
  onCreate: ((date: CivilDate) => void) | null;
}

function daysFor(view: CalendarView, cursor: CivilDate, engine: CalendarEngine): CivilDate[] {
  if (view === 'week') return engine.weekOf(cursor);
  if (view === 'day') return [cursor];
  const grid: CivilDate[] = engine.monthGrid(cursor.y, cursor.m);
  return view === 'agenda' ? grid.filter((d: CivilDate) => d.m === cursor.m) : grid;
}

function headingFor(view: CalendarView, cursor: CivilDate, days: CivilDate[]): string {
  if (view === 'week') return `Week of ${formatDayShort(days[0] as CivilDate)}`;
  if (view === 'day') return formatDayLong(cursor);
  return formatMonth(cursor);
}

export function CalendarTab({ state, dispatch, engine, viewer, displayZone, node, nodeName, now, onOpenChip, onCreate }: CalendarTabProps): JSX.Element {
  const { view, cursor } = state;
  const today: CivilDate = now.date;
  const [focusAgenda, setFocusAgenda] = useState<boolean>(false);
  const days: CivilDate[] = useMemo(() => daysFor(view, cursor, engine), [view, cursor, engine]);
  const placement: Placement = useMemo(() => place(state.entries.values(), days, displayZone, viewer, engine), [state.entries, days, displayZone, viewer, engine]);
  const nodeRuler: { zone: string; hourStarts: bigint[]; } | null = useMemo(() => {
    if (node.zone === null || node.zone === displayZone || (view !== 'week' && view !== 'day')) return null;
    const first: CivilDate = days[0] as CivilDate;
    return { zone: node.zone, hourStarts: HOURS.map((h: number): bigint => engine.instantOf(displayZone, { date: first, minute: h * 60 })) };
  }, [node.zone, displayZone, view, days, engine]);

  const onFocus: (date: CivilDate) => void = useCallback((date: CivilDate): void => dispatch({ type: 'focus', date }), [dispatch]);
  const openDay: (date: CivilDate) => void = useCallback((date: CivilDate): void => {
    dispatch({ type: 'focus', date });
    dispatch({ type: 'view', view: 'agenda' });
    setFocusAgenda(true);
  }, [dispatch]);
  const onView = (next: CalendarView): void => {
    setFocusAgenda(false);
    dispatch({ type: 'view', view: next });
  };
  const onStep = (direction: 1 | -1): void => {
    const date: CivilDate = view === 'week' ? engine.addDays(cursor, 7 * direction) : view === 'day' ? engine.addDays(cursor, direction) : engine.addMonths(cursor, direction);
    dispatch({ type: 'focus', date });
  };

  const shared: { cursor: CivilDate; today: CivilDate; placement: Placement; displayZone: string; nodeName: (id: string) => string; nav: CalendarEngine; onOpenChip: (chip: Chip) => void; onFocus: (date: CivilDate) => void; onOpenDay: (date: CivilDate) => void; onCreate: ((date: CivilDate) => void) | null; onMore: (date: CivilDate) => void; } = { cursor, today, placement, displayZone, nodeName, nav: engine, onOpenChip, onFocus, onOpenDay: openDay, onCreate, onMore: openDay };
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="calendar-tab">
      <CalendarToolbar
        view={view}
        heading={headingFor(view, cursor, days)}
        context={`${node.name} · ${node.zone === null ? 'no time zone set' : zoneAbbreviation(node.zone, placement.fromMs)}`}
        onToday={(): void => onFocus(today)}
        onStep={onStep}
        onView={onView}
        onNew={onCreate === null ? null : (): void => onCreate(cursor)}
      />
      <CalendarNotices loads={state.loads} placement={placement} />
      {view === 'month' && <MonthView {...shared} days={days} />}
      {(view === 'week' || view === 'day') && <WeekView {...shared} view={view} days={days} now={now} nodeRuler={nodeRuler} />}
      {view === 'agenda' && <AgendaView {...shared} days={days} focusCursor={focusAgenda} />}
    </div>
  );
}
