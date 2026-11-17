/**
 * The Intl adapter answers the one question the core asks of the page's time-zone database, to
 * the second, and never guesses: an unknown zone is null, an instant no calendar date holds
 * throws. Run against the runtime's own ICU database, as the page runs it.
 */
import { describe, expect, it } from 'vitest';
import { intlOffsetAt, type OffsetAt } from '../engine/intl-offsets';

const offsetAt: OffsetAt = intlOffsetAt();
const at = (iso: string): number => Date.parse(iso);

describe('intlOffsetAt', () => {
  it('reads both sides of a DST change', () => {
    expect(offsetAt('America/New_York', at('2024-01-15T12:00:00Z'))).toBe(-5 * 3600);
    expect(offsetAt('America/New_York', at('2024-07-15T12:00:00Z'))).toBe(-4 * 3600);
    expect(offsetAt('America/New_York', at('2024-03-10T06:59:59Z'))).toBe(-5 * 3600);
    expect(offsetAt('America/New_York', at('2024-03-10T07:00:00Z'))).toBe(-4 * 3600);
  });

  it('reads offsets that are not whole hours', () => {
    expect(offsetAt('Asia/Kolkata', at('2024-01-15T12:00:00Z'))).toBe(19_800);
    expect(offsetAt('Asia/Kathmandu', at('2024-01-15T12:00:00Z'))).toBe(20_700);
    expect(offsetAt('Australia/Lord_Howe', at('2024-07-15T12:00:00Z'))).toBe(37_800);
  });

  it('reads a local mean time to the second', () => {
    // New York kept its local mean time, UTC-04:56:02, until railway time in November 1883.
    expect(offsetAt('America/New_York', at('1880-06-01T12:00:00Z'))).toBe(-(4 * 3600 + 56 * 60 + 2));
  });

  it('reads an instant before 1970 and one with milliseconds', () => {
    expect(offsetAt('Europe/London', at('1960-01-01T00:00:00.999Z'))).toBe(0);
    expect(offsetAt('Europe/London', at('1960-07-01T00:00:00.999Z'))).toBe(3600);
  });

  it('answers null for a zone the database does not know, and is the same reader after', () => {
    expect(offsetAt('Mars/Olympus_Mons', at('2024-01-15T12:00:00Z'))).toBeNull();
    expect(offsetAt('UTC', at('2024-01-15T12:00:00Z'))).toBe(0);
  });

  it('throws for an instant no calendar date holds, rather than answering for it', () => {
    expect(() => offsetAt('UTC', Number.NaN)).toThrow(RangeError);
    expect(() => offsetAt('UTC', 8.64e15)).toThrow(RangeError);
    expect(() => offsetAt('UTC', -62_200_000_000_000)).toThrow(RangeError);
  });
});
