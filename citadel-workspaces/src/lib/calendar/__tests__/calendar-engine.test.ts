/**
 * The vendored glue, initialised from its committed binary, over the page's own Intl adapter:
 * the path every Calendar answer takes in the page, with nothing faked. What crosses must be the
 * shapes the generated types promise (BigInt instants, `null` for absent values), and a refusal
 * must arrive as the core's code while a fault of the page's own function arrives as itself.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CalendarEngine, CalendarRefusal } from '../engine/calendar-engine';
import type { Event } from '../generated/Event';
import type { Expansion } from '../generated/Expansion';
import type { Occurrence } from '../generated/Occurrence';
import type { Recurrence } from '../generated/Recurrence';
import { at, event, NY, realEngine, utc } from './engine-rig';

let engine: CalendarEngine;
beforeAll(() => {
  engine = realEngine();
});

describe('the Calendar engine in the page', () => {
  it('moves a skipped wall time forward by the gap', () => {
    expect(engine.resolve(NY, at(2024, 3, 10, 2, 30))).toEqual({ gap: { before_s: -18_000, after_s: -14_400 } });
    expect(engine.instantOf(NY, at(2024, 3, 10, 2, 30))).toBe(utc('2024-03-10T07:30:00Z'));
  });

  it('reads a repeated wall time as its first occurrence', () => {
    expect(engine.resolve(NY, at(2024, 11, 3, 1, 30))).toEqual({ fold: { first_s: -14_400, second_s: -18_000 } });
    expect(engine.instantOf(NY, at(2024, 11, 3, 1, 30))).toBe(utc('2024-11-03T05:30:00Z'));
  });

  it('keeps a weekly 09:00 at 09:00 across a DST change, as BigInt instants', () => {
    const weekly: Recurrence = {
      start: at(2024, 3, 4, 9, 0), duration_min: 30, exdates: [], until_ms: null,
      rule: { freq: 'weekly', interval: 1, by_day: [], by_month_day: [], count: 3 },
    };
    const expanded: Expansion = engine.expand(weekly, NY, utc('2024-03-01T00:00:00Z'), utc('2024-04-01T00:00:00Z'));
    expect(expanded.truncated).toBe(false);
    expect(expanded.occurrences.map((o: Occurrence): bigint => o.start_ms)).toEqual([utc('2024-03-04T14:00:00Z'), utc('2024-03-11T13:00:00Z'), utc('2024-03-18T13:00:00Z')]);
    expect(engine.civilOf(NY, expanded.occurrences[1].start_ms)).toEqual(at(2024, 3, 11, 9, 0));
  });

  it('round-trips an event through its stored bytes with null, not undefined, for what is absent', () => {
    const back: Event = engine.decodeEvent(engine.encodeEvent(event({})));
    expect(back).toEqual(event({}));
    expect(back.body).toBeNull();
    expect(back.propagate.up_to).toBeNull();
    expect(typeof back.created_ms).toBe('bigint');
  });

  it('refuses with the core code: an unknown zone, a bad value, bytes of no event', () => {
    const refusal = (body: () => unknown): CalendarRefusal => {
      try {
        body();
      } catch (thrown: unknown) {
        if (thrown instanceof CalendarRefusal) return thrown;
        throw thrown;
      }
      throw new Error('no refusal');
    };
    expect(refusal(() => engine.resolve('Mars/Olympus_Mons', at(2024, 1, 1, 9, 0)))).toMatchObject({ code: 'unknown_zone', detail: 'Mars/Olympus_Mons' });
    expect(refusal(() => engine.resolve('../etc', at(2024, 1, 1, 9, 0))).code).toBe('bad_value');
    expect(refusal(() => engine.decodeEvent(new Uint8Array([1, 2, 3]))).code).toBe('malformed');
    expect(refusal(() => engine.fanOutPlan(event({ visibility: 'private', propagate: { down: true, up_to: null } }), ['n2'])).code).toBe('private_cannot_propagate');
  });

  it('rethrows what the page function threw, never reads it as a zone or a refusal', () => {
    const broken: CalendarEngine = realEngine((): number => {
      throw new TypeError('the database is gone');
    });
    expect(() => broken.resolve(NY, at(2024, 1, 1, 9, 0))).toThrow(TypeError);
    const fractional: CalendarEngine = realEngine((): number => 0.5);
    expect(() => fractional.resolve(NY, at(2024, 1, 1, 9, 0))).toThrow(/whole seconds/);
  });

  it('carries a cal topic change', () => {
    expect(engine.decodeChange(engine.encodeChange({ node: 'n1', key: 'ev/e1' }))).toEqual({ node: 'n1', key: 'ev/e1' });
  });
});
