/**
 * How this app writes dates and times.
 *
 * There were six independent formatters — two of them pinned to `'en-US'` — so
 * the same instant read "2:07 PM" in a chat bubble, "8/27/2026, 2:07:33 PM" in
 * the files sidebar and "3 minutes ago" in a notification, and a user with a
 * French-locale browser got US dates in some places and native dates in others.
 *
 * Locale is deliberately the BROWSER's, never a literal. A hardcoded `'en-US'`
 * is not a formatting choice, it is a bug for everyone outside the US: it writes
 * 3/4/2026 to a reader for whom that means the fourth of March.
 */

/** Just the clock: what a message bubble shows beside its text. */
export function formatClock(timestamp: number | bigint): string {
  return new Date(Number(timestamp)).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A day, with Today/Yesterday for the two a reader recognises instantly. */
export function formatDay(timestamp: number | bigint): string {
  const date: Date = new Date(Number(timestamp));
  const today: Date = new Date();
  const yesterday: Date = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString();
}

/** Day and time together: list rows, properties panels, file metadata. */
export function formatDateTime(timestamp: number | bigint): string {
  return new Date(Number(timestamp)).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Day and time to the second, for diagnostics.
 *
 * Separate from `formatDateTime` because seconds are noise in a list and the
 * point in a "why did this message not arrive" panel.
 */
export function formatPreciseDateTime(timestamp: number | bigint): string {
  return new Date(Number(timestamp)).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const MINUTE_MS: number = 60_000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;
const RELATIVE_HORIZON_DAYS: number = 7;

function counted(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/**
 * How long ago, for notifications, requests and last-active lines.
 *
 * The one relative formatter: "Just now" inside a minute, then whole minutes,
 * hours and days, and past a week the date and time. Four surfaces had four
 * spellings ("5 seconds ago", "Just now", "about 3 hours ago", a bare date).
 */
export function formatRelative(timestamp: number | bigint): string {
  const age: number = Date.now() - Number(timestamp);
  if (age < MINUTE_MS) return 'Just now';
  if (age < HOUR_MS) return counted(Math.floor(age / MINUTE_MS), 'minute');
  if (age < DAY_MS) return counted(Math.floor(age / HOUR_MS), 'hour');
  if (age < RELATIVE_HORIZON_DAYS * DAY_MS) return counted(Math.floor(age / DAY_MS), 'day');
  return formatDateTime(timestamp);
}

/**
 * A conversation row's stamp: WHEN the last message was, in the shortest form
 * that is unambiguous at a glance (clock today, Yesterday, weekday inside a
 * week, short date beyond). Deliberately not relative: a list is scanned by
 * position in time, and "3 hours ago" re-renders to something else every minute.
 */
export function formatListStamp(timestamp: number | bigint): string {
  const date: Date = new Date(Number(timestamp));
  const days: number = Math.floor((Date.now() - date.getTime()) / DAY_MS);
  if (days === 0) return formatClock(timestamp);
  if (days === 1) return 'Yesterday';
  if (days < RELATIVE_HORIZON_DAYS) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
