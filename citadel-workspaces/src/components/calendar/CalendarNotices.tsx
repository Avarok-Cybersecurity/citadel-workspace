/**
 * What the Calendar could not show, said above it rather than left out: a source that failed to
 * read, values in a source the core could not decode, pages below past the core's bound, events whose time the core could not place (design §3.4: "could not place this time",
 * never a guess), and a repeating event with more occurrences than one view expands.
 */
import { AlertTriangle } from 'lucide-react';
import type { Placement, Unplaced } from '@/lib/calendar/placement';
import type { EntrySource, LoadState } from '@/lib/calendar/store';

const SOURCE: Record<EntrySource, string> = {
  node: "this page's events",
  authored: 'events members posted here',
  inherited: 'events from the pages above',
  up_pulled: 'events from the pages below',
  private: 'your private events',
};

const REASON: Partial<Record<Unplaced['code'], string>> = {
  unknown_zone: 'its time zone is not one this browser knows',
  out_of_range: 'its date is outside the years a calendar holds',
  bad_rule: 'its repeat rule cannot be read',
};

interface CalendarNoticesProps {
  loads: ReadonlyMap<EntrySource, LoadState>;
  placement: Placement;
}

function Notice({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-emphasis" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export function CalendarNotices({ loads, placement }: CalendarNoticesProps): JSX.Element | null {
  const failed: { source: EntrySource; reason: string; }[] = [...loads].flatMap(([source, load]) => (load.kind === 'failed' ? [{ source, reason: load.reason }] : []));
  const unreadable: { source: EntrySource; count: number; }[] = [...loads].flatMap(([source, load]) => (load.kind === 'ready' && load.unreadable > 0 ? [{ source, count: load.unreadable }] : []));
  const limited: { source: EntrySource; to: number; }[] = [...loads].flatMap(([source, load]) => (load.kind === 'ready' && load.limitedTo !== null ? [{ source, to: load.limitedTo }] : []));
  if (failed.length === 0 && unreadable.length === 0 && limited.length === 0 && placement.unplaced.length === 0 && !placement.truncated) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Calendar notices" data-testid="calendar-notices">
      {failed.map(({ source, reason }) => (
        <Notice key={source}>Could not read {SOURCE[source]}: {reason}</Notice>
      ))}
      {unreadable.map(({ source, count }) => (
        <Notice key={`unreadable-${source}`}>{count === 1 ? 'One' : count} of {SOURCE[source]} could not be read, so {count === 1 ? 'it is' : 'they are'} not shown.</Notice>
      ))}
      {limited.map(({ source, to }) => (
        <Notice key={`limited-${source}`}>Showing {SOURCE[source]} from the first {to} pages below this one only; open a page further down to see the rest.</Notice>
      ))}
      {placement.unplaced.map((u: Unplaced) => (
        <Notice key={u.entryKey}>
          Could not place “{u.title ?? 'Busy'}” on the calendar: {REASON[u.code] ?? `the calendar refused it (${u.code})`}.
        </Notice>
      ))}
      {placement.truncated && <Notice>A repeating event has more occurrences than this view shows; a shorter view shows them all.</Notice>}
    </ul>
  );
}
