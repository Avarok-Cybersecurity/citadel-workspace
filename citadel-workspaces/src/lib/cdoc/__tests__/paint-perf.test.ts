/**
 * The paint-path measurement runs end to end on the 100-page golden and its numbers mean what
 * they say. Deliberately no time is asserted: timing-sensitive checks run on GitHub runners,
 * never on the shared Mac, and `node scripts/check-cdoc-paint-perf.mjs` prints the times.
 */
import { describe, expect, it } from 'vitest';
import { measurePaint, type PaintPerf } from './perf/paint-perf';

describe('the cdoc paint measurement', () => {
  it('decodes and paints every page of the 100-page golden, serving repeats from the atlas', async () => {
    const r: PaintPerf = await measurePaint(1, 1, 2);
    expect(r.pages).toBe(102);
    expect(r.atlas.misses).toBeGreaterThan(0);
    expect(r.atlas.direct).toBe(0);
    // A few dozen distinct glyphs repeated over 103 pages: almost every draw is a cache hit.
    expect(r.hitRate).toBeGreaterThan(0.99);
    expect([r.decodeMs, r.firstPaintMs, r.allPagesPaintMs].every(Number.isFinite)).toBe(true);
  });
});
