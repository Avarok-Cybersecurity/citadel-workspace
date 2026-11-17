/**
 * What the Calendar could not show is said above it: a source that failed, and how many values of
 * a source that read could not be decoded, while a source that read cleanly says nothing.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Placement } from '@/lib/calendar/placement';
import type { EntrySource, LoadState } from '@/lib/calendar/store';
import { CalendarNotices } from '../CalendarNotices';

const NOTHING_UNPLACED: Placement = { fromMs: 0n, days: new Map(), unplaced: [], truncated: false };

const notices = (loads: [EntrySource, LoadState][]): string[] => {
  render(<CalendarNotices loads={new Map(loads)} placement={NOTHING_UNPLACED} />);
  return screen.queryAllByRole('listitem').map((li) => li.textContent ?? '');
};

describe('the Calendar notices', () => {
  it('count what a source left out, and say a failed source failed', () => {
    expect(notices([['authored', { kind: 'ready', unreadable: 2, limitedTo: null }], ['node', { kind: 'failed', reason: 'a limit was reached (quota)' }]])).toEqual([
      "Could not read this page's events: a limit was reached (quota)",
      '2 of events members posted here could not be read, so they are not shown.',
    ]);
  });

  it('say nothing for sources that read cleanly', () => {
    expect(notices([['node', { kind: 'ready', unreadable: 0, limitedTo: null }], ['private', { kind: 'loading' }]])).toEqual([]);
  });
});
