/**
 * The page's time-zone database for the Calendar's core: the offset in force in a zone at an
 * instant, read from `Intl.DateTimeFormat` (Calendar design 3.4). This is the only question the
 * page answers; whether a wall time is skipped or repeated is derived from it in the core, once.
 *
 * `null` is a zone the browser does not know. An instant outside the years a calendar date
 * covers (1 to 9999) throws, and the core rethrows it from the call that asked: no zone and no
 * instant is answered with a guess, and nothing falls back to UTC.
 */

export type OffsetAt = (zone: string, utcMs: number) => number | null;

const DAY_MS: number = 86_400_000;

function utcStartOfYear(year: number): number {
  const at: Date = new Date(0);
  at.setUTCFullYear(year, 0, 1);
  return at.getTime();
}

/** A day inside year 1 and year 9999 either side, so every zone's wall date is in range. */
const FIRST_MS: number = utcStartOfYear(1) + DAY_MS;
const LAST_MS: number = utcStartOfYear(10000) - DAY_MS;

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallOf(parts: readonly Intl.DateTimeFormatPart[]): Wall {
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part: Intl.DateTimeFormatPart | undefined = parts.find((p: Intl.DateTimeFormatPart): boolean => p.type === type);
    if (part === undefined) throw new Error(`Intl.DateTimeFormat gave no ${type}`);
    return Number(part.value);
  };
  return { year: field('year'), month: field('month'), day: field('day'), hour: field('hour'), minute: field('minute'), second: field('second') };
}

function formatter(zone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
  } catch (error: unknown) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** An offset reader with one formatter per zone, made on first use: construction is the cost. */
export function intlOffsetAt(): OffsetAt {
  const formatters: Map<string, Intl.DateTimeFormat | null> = new Map();
  return (zone: string, utcMs: number): number | null => {
    if (!Number.isFinite(utcMs) || utcMs < FIRST_MS || utcMs > LAST_MS) {
      throw new RangeError(`${utcMs} ms from 1970 is outside the years a calendar date covers`);
    }
    let format: Intl.DateTimeFormat | null | undefined = formatters.get(zone);
    if (format === undefined) {
      format = formatter(zone);
      formatters.set(zone, format);
    }
    if (format === null) return null;
    const instant: number = Math.floor(utcMs / 1000) * 1000;
    const wall: Wall = wallOf(format.formatToParts(instant));
    const asUtc: Date = new Date(0);
    asUtc.setUTCFullYear(wall.year, wall.month - 1, wall.day);
    asUtc.setUTCHours(wall.hour, wall.minute, wall.second, 0);
    return Math.round((asUtc.getTime() - instant) / 1000);
  };
}
