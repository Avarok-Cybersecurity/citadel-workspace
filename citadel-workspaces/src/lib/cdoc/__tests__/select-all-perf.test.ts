/**
 * The Select All measurement runs on a 500-page document and means what it says: with the
 * viewport set a result carries rects for three pages, without it for every line. No time is
 * asserted (timing belongs on GitHub runners); `node scripts/check-cdoc-paint-perf.mjs` prints them.
 */
import { describe, expect, it } from 'vitest';
import { measureSelectAll, type SelectAllPerf } from './perf/select-all-perf';

describe('the cdoc Select All measurement', () => {
  it('selects all of a 500-page document, carrying rects for the viewport only once it is set', async () => {
    const r: SelectAllPerf = await measureSelectAll(500, 2);
    expect(r.pages).toBeGreaterThanOrEqual(500);
    // Three pages' worth of lines, against every line of the document.
    expect(r.withViewport.rects).toBeGreaterThan(0);
    expect(r.withViewport.rects * 100).toBeLessThan(r.withoutViewport.rects);
    expect([r.withViewport.p50Ms, r.withViewport.p95Ms, r.withoutViewport.p95Ms].every(Number.isFinite)).toBe(true);
  }, 300_000);
});
