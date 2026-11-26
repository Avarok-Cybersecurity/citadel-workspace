/**
 * A document of many pictures reopened while its store holds every fetch open: typing and
 * scrolling finish anyway (a keystroke or a page paint that waited on a picture never would),
 * the store sees at most the concurrency limit of fetches at a time (no fetch storm), and once
 * released each picture is fetched exactly once. No time is asserted (timing belongs on GitHub
 * runners); `node scripts/check-cdoc-paint-perf.mjs` prints the times. The control lifts the
 * concurrency limit, and the held fetches grow with the pictures.
 */
import { describe, expect, it } from 'vitest';
import { measurePictureFetch, type PictureFetchPerf } from './perf/picture-fetch-perf';
import { PICTURE_LIMITS } from '../pictures/picture-config';

const PICTURES: number = 24;

describe('fetching the pictures of a reopened document', () => {
  it('never holds up typing or scrolling, and asks the store a bounded number at a time, each once', async () => {
    const r: PictureFetchPerf = await measurePictureFetch(PICTURES, 20);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.heldGets).toBeGreaterThan(0);
    expect(r.heldGets).toBeLessThanOrEqual(PICTURE_LIMITS.fetchConcurrency);
    expect(r.totalGets).toBe(PICTURES);
    expect(r.distinctGets).toBe(PICTURES);
    expect([r.keyP50Ms, r.keyP95Ms, r.pageP50Ms].every(Number.isFinite)).toBe(true);
  }, 120_000);

  it('control: without the limit, every picture painted is fetched at once', async () => {
    const r: PictureFetchPerf = await measurePictureFetch(PICTURES, 0, { ...PICTURE_LIMITS, fetchConcurrency: PICTURES });
    expect(r.heldGets).toBeGreaterThan(PICTURE_LIMITS.fetchConcurrency);
  }, 120_000);
});
