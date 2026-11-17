/**
 * The keystroke measurement runs end to end on a 100-page editor document and its numbers mean
 * what they say. No time is asserted (timing belongs on GitHub runners, never the shared Mac);
 * `node scripts/check-cdoc-paint-perf.mjs` prints the times.
 */
import { describe, expect, it } from 'vitest';
import { measureKeystrokes, type KeystrokePerf } from './perf/keystroke-perf';

describe('the cdoc keystroke measurement', () => {
  it('types into the middle of a 100-page document, repainting about one page per keystroke', async () => {
    const r: KeystrokePerf = await measureKeystrokes(100, 10);
    expect(r.pages).toBeGreaterThanOrEqual(100);
    // One page, now and then two: a word that wraps past a page's last line moves to the next.
    expect(r.dirtyPagesPerKeystroke).toBeGreaterThanOrEqual(1);
    expect(r.dirtyPagesPerKeystroke).toBeLessThan(1.5);
    expect([r.p50Ms, r.p95Ms, r.applyP50Ms].every(Number.isFinite)).toBe(true);
  }, 120_000);
});
