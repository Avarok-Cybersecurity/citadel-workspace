/** Which pages stay mounted and which are painted ahead next (warm-pages.ts), as page numbers. */
import { describe, expect, it } from 'vitest';
import { aheadPages, keptPages } from '../warm-pages';

describe('the pages kept mounted', () => {
  it('are the ones near the view, plus those already painted inside the warm window', () => {
    expect(keptPages([4, 5, 6], [3, 4, 5, 6, 7], new Set([1, 3, 7]))).toEqual([3, 4, 5, 6, 7]);
  });

  it('let go of a painted page once it leaves the warm window', () => {
    expect(keptPages([4, 5, 6], [3, 4, 5, 6, 7], new Set([1, 2]))).toEqual([4, 5, 6]);
  });
});

describe('the pages painted ahead next', () => {
  it('add at most the budget, nearest to the view first (the earlier page on a tie), and say when more wait', () => {
    expect(aheadPages([4, 5, 6], [2, 3, 4, 5, 6, 7, 8], 5, 1)).toEqual({ pages: [3, 4, 5, 6], more: true });
    expect(aheadPages([3, 4, 5, 6], [2, 3, 4, 5, 6, 7, 8], 5, 2)).toEqual({ pages: [2, 3, 4, 5, 6, 7], more: true });
  });

  it('wait for nothing once the warm window is painted', () => {
    expect(aheadPages([2, 3, 4], [2, 3, 4], 3, 1)).toEqual({ pages: [2, 3, 4], more: false });
  });
});
