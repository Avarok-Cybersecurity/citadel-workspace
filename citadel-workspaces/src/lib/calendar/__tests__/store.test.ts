import { describe, expect, it } from 'vitest';
import { calendarReducer, entryKey, initialCalendar, type CalendarState } from '../store';
import { bobsBusy, inherited, standup } from './placement-fixture';

const today: { y: number; m: number; d: number; } = { y: 2026, m: 10, d: 24 };

describe('the Calendar store', () => {
  it('starts on the view and day it is given, with nothing read', () => {
    const s: CalendarState = initialCalendar('agenda', today);
    expect([s.view, s.cursor, s.entries.size, s.loads.size]).toEqual(['agenda', today, 0, 0]);
  });

  it('replaces what one source held without touching another', () => {
    let s: CalendarState = initialCalendar('month', today);
    s = calendarReducer(s, { type: 'read', source: 'node', entries: [standup], unreadable: 0, limitedTo: null });
    s = calendarReducer(s, { type: 'read', source: 'inherited', entries: [inherited], unreadable: 0, limitedTo: null });
    s = calendarReducer(s, { type: 'read', source: 'node', entries: [], unreadable: 0, limitedTo: null });
    expect([...s.entries.keys()]).toEqual([inherited.key]);
    expect(s.loads.get('node')).toEqual({ kind: 'ready', unreadable: 0, limitedTo: null });
  });

  it('keeps what a source read when a later read of it fails, and says it failed', () => {
    let s: CalendarState = calendarReducer(initialCalendar('month', today), { type: 'read', source: 'authored', entries: [bobsBusy], unreadable: 0, limitedTo: null });
    s = calendarReducer(s, { type: 'failed', source: 'authored', reason: 'offline' });
    expect(s.entries.has(bobsBusy.key)).toBe(true);
    expect(s.loads.get('authored')).toEqual({ kind: 'failed', reason: 'offline' });
  });

  it('refuses an entry filed under a source it did not come from', () => {
    expect(() => calendarReducer(initialCalendar('month', today), { type: 'read', source: 'node', entries: [inherited], unreadable: 0, limitedTo: null })).toThrow(/came from inherited/);
  });

  it('removes one entry, and is unchanged by removing one it does not hold', () => {
    const s: CalendarState = calendarReducer(initialCalendar('week', today), { type: 'read', source: 'node', entries: [standup], unreadable: 0, limitedTo: null });
    expect(calendarReducer(s, { type: 'removed', key: standup.key }).entries.size).toBe(0);
    expect(calendarReducer(s, { type: 'removed', key: 'nope' })).toBe(s);
  });

  it('keys an entry by where it was read, escaping each part', () => {
    expect(entryKey('authored', 'n/1', 'bob', 'cal/event/x')).toBe('authored/n%2F1/bob/cal%2Fevent%2Fx');
    expect(entryKey('node', 'n1', null, 'k')).not.toBe(entryKey('authored', 'n1', null, 'k'));
  });
});
