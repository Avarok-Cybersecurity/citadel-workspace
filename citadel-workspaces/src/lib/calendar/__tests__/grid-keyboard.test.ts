/**
 * The grid's keys, over the real engine's date arithmetic: each key lands on the day the design
 * names, across month and year edges, and keys that are not the grid's are left alone.
 */
import { describe, expect, it } from 'vitest';
import { gridIntent, type GridIntent } from '../grid-keyboard';
import type { CivilDate } from '../generated/CivilDate';
import { realEngine } from './engine-rig';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const nav: CalendarEngine = realEngine();
const d = (y: number, m: number, day: number): CivilDate => ({ y, m, d: day });
const focusOn = (date: CivilDate): GridIntent => ({ kind: 'focus', date });

describe('the Calendar grid keys', () => {
  it('arrows move a day, and a week up or down in Month', () => {
    expect(gridIntent('ArrowRight', d(2026, 10, 31), 'month', nav)).toEqual(focusOn(d(2026, 11, 1)));
    expect(gridIntent('ArrowLeft', d(2026, 1, 1), 'month', nav)).toEqual(focusOn(d(2025, 12, 31)));
    expect(gridIntent('ArrowDown', d(2026, 10, 28), 'month', nav)).toEqual(focusOn(d(2026, 11, 4)));
    expect(gridIntent('ArrowUp', d(2026, 10, 3), 'month', nav)).toEqual(focusOn(d(2026, 9, 26)));
  });

  it('up and down are not day moves in Week or Day, so the page may scroll', () => {
    expect(gridIntent('ArrowDown', d(2026, 10, 28), 'week', nav)).toBeNull();
    expect(gridIntent('ArrowUp', d(2026, 10, 28), 'day', nav)).toBeNull();
  });

  it('PageUp and PageDown move a month in Month, clamped, and a week elsewhere', () => {
    expect(gridIntent('PageDown', d(2026, 1, 31), 'month', nav)).toEqual(focusOn(d(2026, 2, 28)));
    expect(gridIntent('PageUp', d(2026, 1, 15), 'month', nav)).toEqual(focusOn(d(2025, 12, 15)));
    expect(gridIntent('PageDown', d(2026, 12, 29), 'week', nav)).toEqual(focusOn(d(2027, 1, 5)));
    expect(gridIntent('PageUp', d(2026, 10, 1), 'day', nav)).toEqual(focusOn(d(2026, 9, 24)));
  });

  it("Home and End go to the week's Monday and Sunday", () => {
    expect(gridIntent('Home', d(2026, 10, 1), 'month', nav)).toEqual(focusOn(d(2026, 9, 28)));
    expect(gridIntent('End', d(2026, 10, 1), 'week', nav)).toEqual(focusOn(d(2026, 10, 4)));
  });

  it('Enter and Space open the day; + and n create on it', () => {
    const day: CivilDate = d(2026, 10, 8);
    expect(gridIntent('Enter', day, 'month', nav)).toEqual({ kind: 'open', date: day });
    expect(gridIntent(' ', day, 'week', nav)).toEqual({ kind: 'open', date: day });
    expect(gridIntent('+', day, 'month', nav)).toEqual({ kind: 'create', date: day });
    expect(gridIntent('n', day, 'day', nav)).toEqual({ kind: 'create', date: day });
  });

  it('leaves every other key to the page', () => {
    for (const key of ['Tab', 'Escape', 'a', 'N', 'Shift']) expect(gridIntent(key, d(2026, 10, 8), 'month', nav)).toBeNull();
  });
});
