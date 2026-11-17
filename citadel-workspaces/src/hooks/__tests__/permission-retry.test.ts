import { describe, it, expect } from 'vitest';
import {
  MAX_PERMISSION_ATTEMPTS,
  PERMISSION_RETRY_DELAYS_MS,
  nextRetryDelayMs,
} from '../permission-retry';

describe('the permission fetch schedule', () => {
  it('tries immediately the first time', () => {
    expect(nextRetryDelayMs(0)).toBe(0);
  });

  it('backs off between retries rather than hammering', () => {
    expect(nextRetryDelayMs(1)).toBe(400);
    expect(nextRetryDelayMs(2)).toBe(1_200);
    expect(nextRetryDelayMs(3)).toBe(3_000);
    // Strictly increasing, so a slow start-up is waited out rather than
    // spending the whole budget in the first second.
    const delays: readonly number[] = PERMISSION_RETRY_DELAYS_MS;
    for (let i: number = 1; i < delays.length; i += 1) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
  });

  it('gives up, so a domain that cannot be read is not asked about forever', () => {
    expect(nextRetryDelayMs(MAX_PERMISSION_ATTEMPTS)).toBeNull();
    expect(nextRetryDelayMs(MAX_PERMISSION_ATTEMPTS + 5)).toBeNull();
  });

  it('spends its whole budget inside five seconds', () => {
    // The control this gates is the Edit button. A budget measured in minutes
    // would be the same defect wearing a retry loop.
    const total: number = PERMISSION_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeLessThanOrEqual(5_000);
  });
});
