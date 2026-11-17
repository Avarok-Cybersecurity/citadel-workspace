/**
 * Pages land on whole device pixels: every page's CSS size is whole, its top in the column is a
 * whole number of device px, and its left edge is moved onto the screen's device-pixel grid
 * wherever the column starts. A canvas off that grid is resampled by the compositor and blurs.
 */
import { describe, expect, it } from 'vitest';
import { deviceResidue, layoutPages, pageLeft, type PageLayout } from '../page-view/page-layout';
import { deviceScale } from '@/lib/cdoc/paint/units';

/** Three A4 portrait pages, Pt100. */
const A4: Int32Array = Int32Array.from([59530, 84190, 59530, 84190, 59530, 84190]);
const onGrid = (cssPx: number, dpr: number): boolean => Math.abs(cssPx * dpr - Math.round(cssPx * dpr)) < 1e-9;

describe('the page layout', () => {
  it.each([1, 1.25, 1.5, 2, 3])('puts every page at a whole CSS size and a device-pixel top at DPR %d', (dpr: number) => {
    const layout: PageLayout = layoutPages(A4, deviceScale(1, dpr), 24);
    for (const box of layout.boxes) {
      expect(Number.isInteger(box.width) && Number.isInteger(box.height), `page ${box.pageNumber} size`).toBe(true);
      expect(onGrid(box.top, dpr), `page ${box.pageNumber} top ${box.top}`).toBe(true);
    }
  });

  it.each([
    [1, 0], [1, 0.3], [2, 0], [2, 0.3], [1.25, 0.7],
  ])('centres a page on the device grid at DPR %d with the column at %d px', (dpr: number, columnLeft: number) => {
    // 793.5 CSS px is the width that left a 2x page half a device pixel off before.
    const left: number = pageLeft(1101, 793.5, columnLeft, dpr);
    expect(onGrid(columnLeft + left, dpr)).toBe(true);
    expect(Math.abs(left - (1101 - 793.5) / 2)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
  });

  it('moves a position by at most half a device pixel onto the grid', () => {
    expect(deviceResidue(10.25, 2)).toBeCloseTo(0.25);
    expect(deviceResidue(10.2, 1)).toBeCloseTo(-0.2);
    expect(deviceResidue(10, 2)).toBe(0);
  });
});
