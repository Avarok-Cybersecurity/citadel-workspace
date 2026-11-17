/**
 * How the Calendar writes times and dates: in the browser's locale (as `lib/format-time.ts`
 * decides for the whole app), and always in a named zone, so a time is never silently the
 * device's. A civil date is formatted as itself (read in UTC, where it has no offset to shift it).
 */
import type { CivilDate } from './generated/CivilDate';

const civil = (date: CivilDate): Date => new Date(Date.UTC(date.y, date.m - 1, date.d));

const formatters: Map<string, Intl.DateTimeFormat> = new Map();
function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f: Intl.DateTimeFormat | undefined = formatters.get(key);
  if (f === undefined) {
    f = new Intl.DateTimeFormat([], options);
    formatters.set(key, f);
  }
  return f;
}

/** "09:30" or "9:30 AM", by locale, on `zone`'s clock. */
export function formatTimeIn(utcMs: bigint, zone: string): string {
  return formatter(`time:${zone}`, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(Number(utcMs));
}

/** The zone's short name at an instant: "EDT", or "GMT+2" where the locale has no abbreviation. */
export function zoneAbbreviation(zone: string, atMs: bigint): string {
  const parts: Intl.DateTimeFormatPart[] = formatter(`zone:${zone}`, { timeZone: zone, timeZoneName: 'short' }).formatToParts(Number(atMs));
  const name: Intl.DateTimeFormatPart | undefined = parts.find((p: Intl.DateTimeFormatPart): boolean => p.type === 'timeZoneName');
  if (name === undefined) throw new Error(`Intl names no zone for ${zone}`);
  return name.value;
}

/** "October 2026". */
export const formatMonth = (date: CivilDate): string => formatter('month', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(civil(date));

/** "Thu 8 Oct", by locale. */
export const formatDayShort = (date: CivilDate): string =>
  formatter('day-short', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(civil(date));

/** "Thursday, 8 October 2026", for labels a screen reader reads. */
export const formatDayLong = (date: CivilDate): string =>
  formatter('day-long', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(civil(date));

/** "Mon", for column headers. */
export const formatWeekday = (date: CivilDate): string => formatter('weekday', { weekday: 'short', timeZone: 'UTC' }).format(civil(date));

/** An hour of the day for a ruler: "09:00" or "9 AM", by locale. */
export const formatHour = (hour: number): string =>
  formatter('hour', { hour: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, hour));
