/**
 * A transfer's rate and time remaining, derived from its progress reports.
 *
 * The service records a percentage and the file's size, and nothing about time
 * beyond `updatedAt`. Each report is a sample (bytes moved, when); the rate is
 * the bytes between two samples over the time between them, smoothed with an
 * exponential moving average so a tick that arrives late does not halve the
 * figure for a moment.
 */
export interface RateSample {
  bytes: number;
  at: number;
}

export interface RateState {
  last: RateSample;
  bytesPerSecond: number | null;
}

/** How much of each new interval's rate replaces the running figure. */
const SMOOTHING: number = 0.3;

export function nextRate(prev: RateState | undefined, sample: RateSample): RateState {
  if (prev === undefined || sample.bytes < prev.last.bytes) return { last: sample, bytesPerSecond: null };
  const elapsedMs: number = sample.at - prev.last.at;
  if (elapsedMs <= 0) return prev;
  const instant: number = ((sample.bytes - prev.last.bytes) * 1000) / elapsedMs;
  const bytesPerSecond: number = prev.bytesPerSecond === null
    ? instant
    : prev.bytesPerSecond + SMOOTHING * (instant - prev.bytesPerSecond);
  return { last: sample, bytesPerSecond };
}

export function bytesMoved(percentage: number, totalBytes: number): number {
  return Math.round((Math.min(Math.max(percentage, 0), 100) / 100) * totalBytes);
}

export function etaSeconds(totalBytes: number, moved: number, bytesPerSecond: number | null): number | null {
  if (bytesPerSecond === null || bytesPerSecond <= 0) return null;
  return Math.ceil(Math.max(totalBytes - moved, 0) / bytesPerSecond);
}
