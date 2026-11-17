/**
 * The Calendar tab over the real engine and Intl, fed the fixture of every kind of entry: what
 * each view says about an event in words, the month grid's single roving tab stop and its keys,
 * and Enter taking a day to Agenda with focus on its first event.
 */
import { useReducer } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { realEngine } from '@/lib/calendar/__tests__/engine-rig';
import { JULY_WEEK, VIEWER } from '@/lib/calendar/__tests__/placement-fixture';
import type { CivilDateTime } from '@/lib/calendar/generated/CivilDateTime';
import { calendarReducer, initialCalendar, type CalendarView, type CalendarState } from '@/lib/calendar/store';
import { CalendarTab } from '../CalendarTab';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const NOW: CivilDateTime = { date: { y: 2024, m: 7, d: 16 }, minute: 600 };
const NAMES: Record<string, string> = { company: 'Company', 'team-d': 'Team D', n1: 'Platform' };

function Tab({ view, zone = 'America/New_York' }: { view: CalendarView; zone?: string }): JSX.Element {
  const [state, dispatch] = useReducer(calendarReducer, undefined, () => {
    const s: CalendarState = initialCalendar(view, NOW.date);
    return calendarReducer(s, { type: 'read', source: 'node', entries: JULY_WEEK.filter((e) => e.source === 'node'), unreadable: 0, limitedTo: null });
  });
  const withOthers: CalendarState = JULY_WEEK.filter((e) => e.source !== 'node').reduce((s, e) => ({ ...s, entries: new Map([...s.entries, [e.key, e]]) }), state);
  return (
    <CalendarTab state={withOthers} dispatch={dispatch} engine={engine} viewer={VIEWER} displayZone={zone}
      node={{ id: 'n1', name: 'Platform', zone: 'America/New_York' }} nodeName={(id: string): string => NAMES[id] ?? id}
      now={NOW} onOpenChip={(): void => {}} onCreate={(): void => {}} />
  );
}

/** jsdom lays nothing out and has no scrollIntoView; recording it shows which day Agenda scrolled to. */
let scrolledTo: string[] = [];
beforeEach((): void => {
  scrolledTo = [];
  Element.prototype.scrollIntoView = function record(this: Element): void {
    scrolledTo.push((this as HTMLElement).dataset.agendaDay ?? this.tagName);
  };
});

const cells = (): HTMLElement[] => within(screen.getByTestId('calendar-month-grid')).getAllByRole('gridcell');
const tabStops = (): HTMLElement[] => cells().filter((c) => c.tabIndex === 0);

describe('the Calendar tab', () => {
  it('says in words what each event is: busy, cancelled, inherited, up-pulled', () => {
    render(<Tab view="agenda" />);
    const names: string[] = screen.getAllByTestId('calendar-event-chip').map((c) => c.getAttribute('aria-label') ?? '');
    expect(names.some((n) => n.startsWith('Busy, '))).toBe(true);
    expect(names.some((n) => n.startsWith('Retro, ') && n.endsWith(', cancelled'))).toBe(true);
    expect(names.some((n) => n.startsWith('All-hands, ') && n.includes('From Company'))).toBe(true);
    expect(names.some((n) => n.startsWith('Design review, ') && n.includes('From Team D'))).toBe(true);
    expect(screen.getByText('Retro')).toHaveClass('line-through');
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
  });

  it('prints the zone beside an event made in another zone, and the clock zone on every agenda row', () => {
    render(<Tab view="agenda" zone="America/Chicago" />);
    expect(screen.getAllByTestId('calendar-zone-badge').map((b) => b.textContent)).toContain('EDT');
    expect(screen.getAllByText('CDT').length).toBeGreaterThan(0);
  });

  it('keeps one day of the month grid in the tab order, the focused one', () => {
    render(<Tab view="month" />);
    expect(cells()).toHaveLength(35);
    expect(tabStops().map((c) => c.dataset.date)).toEqual(['2024-07-16']);
    expect(cells().find((c) => c.getAttribute('aria-current') === 'date')?.dataset.date).toBe('2024-07-16');
  });

  it('moves the tab stop and focus with the keys, into the next month', () => {
    render(<Tab view="month" />);
    const start: HTMLElement = tabStops()[0] as HTMLElement;
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tabStops()[0]);
    expect(tabStops().map((c) => c.dataset.date)).toEqual(['2024-07-23']);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'PageDown' });
    expect(screen.getByTestId('calendar-heading')).toHaveTextContent(/August 2024|2024/);
    expect((document.activeElement as HTMLElement).dataset.date).toBe('2024-08-23');
  });

  it('opens a day in Agenda with Enter and puts focus on its first event', () => {
    render(<Tab view="month" />);
    const day: HTMLElement = cells().find((c) => c.dataset.date === '2024-07-15') as HTMLElement;
    act(() => day.focus());
    fireEvent.keyDown(day, { key: 'Enter' });
    expect(screen.getByTestId('calendar-agenda-view')).toBeInTheDocument();
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Standup, /);
    expect(scrolledTo).toEqual(['2024-07-15']);
  });

  it('draws a second ruler in the node zone when the member reads in another', () => {
    const { unmount } = render(<Tab view="week" zone="Europe/London" />);
    expect(screen.getAllByTestId('calendar-time-ruler')).toHaveLength(2);
    unmount();
    render(<Tab view="week" />);
    expect(screen.getAllByTestId('calendar-time-ruler')).toHaveLength(1);
  });
});
