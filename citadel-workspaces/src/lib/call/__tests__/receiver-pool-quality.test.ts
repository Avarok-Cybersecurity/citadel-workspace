/**
 * The pool is where per-peer frames and gaps converge, so it is where quality
 * is tracked. These pin the WIRING rather than the thresholds — call-quality's
 * own tests own those — because the tracker and the tile were both already
 * built and correct, and the only thing missing was anything connecting them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReceiverPool } from '../receiver-pool';
import { POOR_THRESHOLD } from '../call-quality';

function pool(): ReceiverPool {
  return new ReceiverPool({
    onStreamsChanged: (): void => {},
    onNeedKeyframe: (): void => {},
    fallbackCodec: () => 'vp8',
  });
}

const PEER: bigint = 7n;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ReceiverPool connection quality', () => {
  it('reports nothing for a peer that has sent nothing', () => {
    // Absent, not 'good': the tile defaults for an unknown peer, and inventing
    // a verdict for a link with no evidence would be a different claim.
    expect(pool().connectionQuality(Date.now()).size).toBe(0);
  });

  it('reports a gap-free link as good', () => {
    const p: ReceiverPool = pool();
    p.gap(PEER, 0, true);
    // One gap is a hiccup, not a failing link.
    expect(p.connectionQuality(Date.now()).get(PEER)).toBe('good');
  });

  it('degrades a link that keeps losing frames', () => {
    const p: ReceiverPool = pool();
    for (let i: number = 0; i < POOR_THRESHOLD; i += 1) p.gap(PEER, 0, true);
    expect(p.connectionQuality(Date.now()).get(PEER)).toBe('poor');
  });

  it('forgets a peer that leaves, so a rejoin starts clean', () => {
    const p: ReceiverPool = pool();
    for (let i: number = 0; i < POOR_THRESHOLD; i += 1) p.gap(PEER, 0, true);
    p.remove(PEER);
    expect(p.connectionQuality(Date.now()).has(PEER)).toBe(false);
  });

  it('drops every peer when the call closes', () => {
    const p: ReceiverPool = pool();
    p.gap(PEER, 0, true);
    p.closeAll();
    expect(p.connectionQuality(Date.now()).size).toBe(0);
  });
});
