/**
 * The core's grid navigation through the page's engine: the same days the native tests prove,
 * and a date past the core's years refused as `out_of_range`, never wrapped.
 */
import { describe, expect, it } from 'vitest';
import { CalendarRefusal } from '../engine/calendar-engine';
import { realEngine } from './engine-rig';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();

describe("the engine's grid navigation", () => {
  it('lays out October 2026 from Monday 28 September to Sunday 1 November', () => {
    const grid: CivilDate[] = engine.monthGrid(2026, 10);
    expect(grid).toHaveLength(35);
    expect(grid[0]).toEqual({ y: 2026, m: 9, d: 28 });
    expect(grid[34]).toEqual({ y: 2026, m: 11, d: 1 });
  });

  it('names weekdays and weeks Monday first', () => {
    expect(engine.weekdayOf({ y: 2026, m: 10, d: 24 })).toBe('sat');
    expect(engine.weekOf({ y: 2026, m: 10, d: 24 })[0]).toEqual({ y: 2026, m: 10, d: 19 });
  });

  it('refuses a grid or a day beyond year 9999', () => {
    expect(() => engine.monthGrid(9999, 12)).toThrow(CalendarRefusal);
    try {
      engine.addDays({ y: 9999, m: 12, d: 31 }, 1);
      expect.unreachable('a day past 9999 was given');
    } catch (thrown: unknown) {
      expect(thrown).toBeInstanceOf(CalendarRefusal);
      expect((thrown as CalendarRefusal).code).toBe('out_of_range');
    }
  });
});
