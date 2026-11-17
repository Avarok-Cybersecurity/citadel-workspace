/**
 * The transfers panel shows a rate and an ETA, which the service does not keep:
 * it has a percentage and the file's size. The rate is derived from successive
 * progress reports -- bytes moved over time elapsed, smoothed so one late tick
 * does not swing it -- and the ETA from that.
 */
import { describe, it, expect } from 'vitest';
import { nextRate, etaSeconds, bytesMoved, type RateState } from '../transfer-rate';

const MB: number = 1024 * 1024;

describe('the rate of a transfer', () => {
  it('is unknown from a single report', () => {
    expect(nextRate(undefined, { bytes: MB, at: 1000 }).bytesPerSecond).toBeNull();
  });

  it('is bytes moved over time elapsed between two reports', () => {
    const first: RateState = nextRate(undefined, { bytes: 0, at: 0 });
    expect(nextRate(first, { bytes: 2 * MB, at: 1000 }).bytesPerSecond).toBe(2 * MB);
  });

  it('is smoothed, so one slow interval does not halve it', () => {
    let state: RateState = nextRate(undefined, { bytes: 0, at: 0 });
    state = nextRate(state, { bytes: 2 * MB, at: 1000 });
    state = nextRate(state, { bytes: 3 * MB, at: 2000 });
    const rate: number = state.bytesPerSecond ?? 0;
    expect(rate).toBeLessThan(2 * MB);
    expect(rate).toBeGreaterThan(1 * MB);
  });

  it('ignores a report that arrives at the same instant', () => {
    const first: RateState = nextRate(nextRate(undefined, { bytes: 0, at: 0 }), { bytes: MB, at: 1000 });
    expect(nextRate(first, { bytes: 2 * MB, at: 1000 })).toEqual(first);
  });

  it('starts over when the bytes go backwards: a restarted transfer is not a negative rate', () => {
    const moving: RateState = nextRate(nextRate(undefined, { bytes: 0, at: 0 }), { bytes: 5 * MB, at: 1000 });
    expect(nextRate(moving, { bytes: MB, at: 2000 }).bytesPerSecond).toBeNull();
  });
});

describe('what is left', () => {
  it('is the bytes remaining at the current rate', () => {
    expect(etaSeconds(10 * MB, 4 * MB, 2 * MB)).toBe(3);
  });

  it('is unknown without a rate', () => {
    expect(etaSeconds(10 * MB, 4 * MB, null)).toBeNull();
    expect(etaSeconds(10 * MB, 4 * MB, 0)).toBeNull();
  });

  it('reads the bytes moved from a percentage of the size', () => {
    expect(bytesMoved(50, 10 * MB)).toBe(5 * MB);
  });
});
