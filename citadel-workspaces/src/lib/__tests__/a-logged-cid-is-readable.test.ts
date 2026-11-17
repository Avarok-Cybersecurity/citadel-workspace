/**
 * A log line whose whole purpose is to name a CID must name it.
 *
 * Every CID here is a `bigint`, and Playwright's `consoleMessage.text()` renders
 * a bare bigint argument as `undefined`. Measured directly in a browser:
 *
 *   console.log('x:', 123n)          ->  "x: undefined"
 *   console.log('x:', { cid: 789n }) ->  "x: {cid: 789n}"
 *
 * So every captured CI run has been reading `undefined` for real values. That is
 * worse than no log line, because it gets believed: an open lead claiming the
 * wire sometimes omits `ActiveSession.cid` was founded on
 * "Disconnecting session: undefined", and the wire had never omitted it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { debugLog, errorLog, warnLog } from '../debug-config';

afterEach((): void => { vi.restoreAllMocks(); });

describe('logging a bigint', () => {
  it('prints the number, not undefined', () => {
    const spy: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'error').mockImplementation(() => {});
    errorLog('Session', 'disconnecting:', 4242n);
    expect(spy).toHaveBeenCalledWith('[Session]', 'disconnecting:', '4242n');
  });

  it('leaves everything else alone', () => {
    // Objects already print their bigints, and rewriting them would lose the
    // structure the console renders for free.
    const spy: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shape: { cid: bigint } = { cid: 7n };
    warnLog('Session', 'state:', shape, 'ok', 3, null);
    expect(spy).toHaveBeenCalledWith('[Session]', 'state:', shape, 'ok', 3, null);
  });

  it('applies to debugLog too, which is where CIDs are actually logged', () => {
    const spy: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'log').mockImplementation(() => {});
    debugLog('Session', 'cid:', 1n);
    // debugLog is a no-op outside dev; when it does emit, it emits the number.
    for (const call of spy.mock.calls) expect(call).not.toContain(undefined);
  });
});
