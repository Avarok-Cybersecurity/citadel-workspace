/**
 * `cancelRetry` used to delete the attempt entry only when a retry timer
 * existed — and `timeout` is null until a retry is actually scheduled. So a
 * session that connected on its FIRST attempt kept its entry forever, and the
 * scheduler skips any session already present in that map. Auto-reconnect never
 * fired again for that account for the life of the tab: succeeding once
 * disabled the recovery path.
 *
 * These assert on the map after the call, which is the state the scheduler
 * actually reads.
 */
import { describe, it, expect, vi   } from 'vitest';
import { cancelRetry } from '../reconnect-logic';
import type { ConnectionAttempt } from '../types';

const key: "alice@wss://example.test" = 'alice@wss://example.test';

describe('cancelRetry', () => {
  it('removes an entry that never scheduled a retry (the happy path)', () => {
    const attempts: Map<string, ConnectionAttempt> = new Map<string, ConnectionAttempt>([
      [key, { sessionKey: key, attempts: 0, timeout: null }],
    ]);

    cancelRetry(attempts, key);

    // The regression: this entry used to survive, and its presence is exactly
    // what makes the scheduler skip the session forever.
    expect(attempts.has(key)).toBe(false);
  });

  it('clears the timer and removes the entry when a retry was pending', () => {
    const clearSpy: ReturnType<typeof vi.spyOn> = vi.spyOn(globalThis, 'clearTimeout');
    const timer: NodeJS.Timeout = setTimeout((): void => {}, 10_000) as unknown as ReturnType<typeof setTimeout>;
    const attempts: Map<string, ConnectionAttempt> = new Map<string, ConnectionAttempt>([
      [key, { sessionKey: key, attempts: 3, timeout: timer }],
    ]);

    cancelRetry(attempts, key);

    expect(clearSpy).toHaveBeenCalledWith(timer);
    expect(attempts.has(key)).toBe(false);
    clearSpy.mockRestore();
  });

  it('is a no-op for a session it does not know about', () => {
    const attempts: Map<string, ConnectionAttempt> = new Map<string, ConnectionAttempt>();
    expect(() => cancelRetry(attempts, 'nobody@nowhere')).not.toThrow();
    expect(attempts.size).toBe(0);
  });
});
