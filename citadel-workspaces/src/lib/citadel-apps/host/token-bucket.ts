/**
 * A token bucket over an injected clock: `ratePerSecond` tokens, refilled continuously, full at
 * start. Pure: the caller passes `now` (ms), so tests drive time and no timer runs.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly ratePerSecond: number, now: number) {
    if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) throw new Error(`token bucket: rate must be positive, got ${ratePerSecond}`);
    this.tokens = ratePerSecond;
    this.last = now;
  }

  /** Takes one token if there is one. */
  take(now: number): boolean {
    const elapsed: number = Math.max(0, now - this.last);
    this.last = Math.max(this.last, now);
    this.tokens = Math.min(this.ratePerSecond, this.tokens + (elapsed * this.ratePerSecond) / 1000);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
