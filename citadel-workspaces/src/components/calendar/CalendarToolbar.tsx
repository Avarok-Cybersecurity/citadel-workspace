/**
 * The Calendar's header (design §3.9): Today, previous and next, what is on screen, the four views
 * and New. Each control is a labelled button of at least 44px; on a phone the views wrap to a
 * second row rather than shrink.
 */
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalendarView } from '@/lib/calendar/store';

const VIEWS: { view: CalendarView; label: string }[] = [
  { view: 'month', label: 'Month' },
  { view: 'week', label: 'Week' },
  { view: 'day', label: 'Day' },
  { view: 'agenda', label: 'Agenda' },
];

const STEP: Record<CalendarView, string> = { month: 'month', week: 'week', day: 'day', agenda: 'month' };

interface CalendarToolbarProps {
  view: CalendarView;
  /** What is on screen: "October 2026", "Week of Mon 5 Oct". */
  heading: string;
  /** The node and its zone: "Platform · EST". */
  context: string;
  onToday: () => void;
  onStep: (direction: 1 | -1) => void;
  onView: (view: CalendarView) => void;
  /** Null while no event can be made here: no New button is drawn rather than one that does nothing. */
  onNew: (() => void) | null;
}

const TARGET: string = 'h-[44px] min-w-[44px]';

export function CalendarToolbar({ view, heading, context, onToday, onStep, onView, onNew }: CalendarToolbarProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2" data-testid="calendar-toolbar">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Button variant="outline" className={TARGET} onClick={onToday}>Today</Button>
        <Button variant="ghost" size="icon" className={TARGET} aria-label={`Previous ${STEP[view]}`} onClick={(): void => onStep(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" className={TARGET} aria-label={`Next ${STEP[view]}`} onClick={(): void => onStep(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-base font-semibold" aria-live="polite" data-testid="calendar-heading">{heading}</h2>
          <span className="truncate text-xs text-muted-foreground">{context}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border border-border">
          {VIEWS.map(({ view: v, label }) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              onClick={(): void => onView(v)}
              className={cn(
                'h-[44px] min-w-[44px] rounded-sm px-2.5 text-sm font-medium text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                v === view ? 'bg-primary text-primary-foreground' : 'hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {onNew !== null && (
          <Button className={TARGET} onClick={onNew}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>New</span>
          </Button>
        )}
      </div>
    </div>
  );
}
