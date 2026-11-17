/**
 * The image-page measurement means what it says: after the first paint a keystroke decodes no
 * image, and the control (no room in the cache) decodes on every repaint. No time is asserted.
 */
import { describe, expect, it } from 'vitest';
import { measureImagePage, type ImagePagePerf } from './perf/image-perf';

describe('the cdoc image-page measurement', () => {
  it('decodes nothing per keystroke once cached, and again every repaint without the cache', async () => {
    const cached: ImagePagePerf = await measureImagePage(10, true);
    const control: ImagePagePerf = await measureImagePage(10, false);
    expect(cached.decodesPerKeystroke).toBe(0);
    expect(control.decodesPerKeystroke).toBeGreaterThanOrEqual(1);
    expect([cached.p50Ms, cached.p95Ms].every(Number.isFinite)).toBe(true);
  }, 120_000);
});
