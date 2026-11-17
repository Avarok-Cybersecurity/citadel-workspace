/**
 * "5 seconds ago", "Just now", "about 3 hours ago" and a bare date were four
 * spellings of the same relative time on four surfaces. One function writes it;
 * the list stamp is the only deliberate exception (a row shows WHEN, not how long ago).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelative, formatListStamp, formatClock, formatDateTime } from '../format-time';
import { formatPresence } from '../date-utils';

const NOW: number = new Date(2026, 9, 8, 15, 0, 0).getTime();
const ago = (ms: number): number => NOW - ms;
const MIN: number = 60_000;
const HOUR: number = 60 * MIN;
const DAY: number = 24 * HOUR;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('formatRelative', () => {
  it('says Just now inside a minute, then counts', () => {
    expect(formatRelative(ago(4_000))).toBe('Just now');
    expect(formatRelative(ago(59_000))).toBe('Just now');
    expect(formatRelative(ago(MIN))).toBe('1 minute ago');
    expect(formatRelative(ago(5 * MIN))).toBe('5 minutes ago');
    expect(formatRelative(ago(HOUR))).toBe('1 hour ago');
    expect(formatRelative(ago(3 * HOUR))).toBe('3 hours ago');
    expect(formatRelative(ago(2 * DAY))).toBe('2 days ago');
  });

  it('falls back to the app date-time after a week', () => {
    expect(formatRelative(ago(8 * DAY))).toBe(formatDateTime(ago(8 * DAY)));
  });
});

describe('every relative surface agrees', () => {
  it('the last-active line uses it', () => {
    expect(formatPresence(false, ago(3 * HOUR))).toBe('Last active 3 hours ago');
  });
});

describe('formatListStamp (deliberately not relative)', () => {
  it('shows the clock today, Yesterday, the weekday inside a week, else the short date', () => {
    expect(formatListStamp(ago(HOUR))).toBe(formatClock(ago(HOUR)));
    expect(formatListStamp(ago(DAY))).toBe('Yesterday');
    expect(formatListStamp(ago(3 * DAY))).toBe(new Date(ago(3 * DAY)).toLocaleDateString([], { weekday: 'short' }));
    expect(formatListStamp(ago(30 * DAY))).toBe(new Date(ago(30 * DAY)).toLocaleDateString([], { month: 'short', day: 'numeric' }));
  });
});
