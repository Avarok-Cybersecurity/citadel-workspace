/**
 * The performance floor is judged on the best run, and a run Lighthouse could
 * not score (NO_LCP) must not be the one chosen.
 *
 * Tested directly because NO_LCP cannot be produced on demand: it came from a
 * loaded CI runner, once, in the middle of three samples.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper shared with the CI script, no types.
import { bestPerformanceRun } from '../lighthouse-best-run.mjs';

interface Run {
  categories: { performance: { score: number | null } };
}

const run = (score: number | null): Run => ({ categories: { performance: { score } } });

describe('bestPerformanceRun', () => {
  it('skips an unscored run in the middle and points at the best scored one', () => {
    const runs: Run[] = [run(0.68), run(null), run(0.74)];
    expect(bestPerformanceRun(runs)).toBe(2);
  });

  it('skips an unscored first run', () => {
    const runs: Run[] = [run(null), run(0.74), run(0.68)];
    expect(bestPerformanceRun(runs)).toBe(1);
  });

  it('picks the highest score when every run scored', () => {
    const runs: Run[] = [run(0.5), run(0.9), run(0.7)];
    expect(bestPerformanceRun(runs)).toBe(1);
  });

  it('reports no run when none scored, so the gate still fails', () => {
    const runs: Run[] = [run(null), run(null)];
    expect(bestPerformanceRun(runs)).toBe(-1);
  });
});
