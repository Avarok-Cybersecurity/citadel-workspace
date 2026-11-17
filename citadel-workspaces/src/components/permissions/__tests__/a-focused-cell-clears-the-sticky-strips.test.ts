/**
 * A focused cell under the matrix's sticky permission column or header, or past the scroller's
 * visible edge, is scrolled by exactly the overlap; one already in clear view is left where it is.
 * See sticky-clearance.ts.
 */
import { describe, it, expect } from 'vitest';
import { scrollToShowClear, type Edges } from '../sticky-clearance';

const view: Edges = { left: 0, top: 0, right: 356, bottom: 420 };
const column: Edges = { left: 0, top: 0, right: 106, bottom: 420 };
const header: Edges = { left: 0, top: 0, right: 356, bottom: 48 };
const at = (left: number, top: number): Edges => ({ left, top, right: left + 24, bottom: top + 24 });
const show = (cell: Edges): { left: number; top: number } => scrollToShowClear(cell, column, header, view);

describe('a focused cell in the role matrix', () => {
  it('is left alone when in clear view', () => {
    expect(show(at(200, 120))).toEqual({ left: 0, top: 0 });
  });

  it('is scrolled back out from under the permission column by the overlap', () => {
    expect(show(at(90, 120))).toEqual({ left: -16, top: 0 });
  });

  it('is scrolled back to sit below the header, by the overlap', () => {
    expect(show(at(200, 30))).toEqual({ left: 0, top: -18 });
  });

  it('clears both strips at once when under their corner', () => {
    expect(show(at(10, 10))).toEqual({ left: -96, top: -38 });
  });

  it('is scrolled on when it runs past the right edge, partly or wholly', () => {
    expect(show(at(345, 120))).toEqual({ left: 13, top: 0 });
    expect(show(at(375, 120))).toEqual({ left: 43, top: 0 });
  });

  it('is scrolled on when it runs past the bottom edge', () => {
    expect(show(at(200, 410))).toEqual({ left: 0, top: 14 });
  });
});
