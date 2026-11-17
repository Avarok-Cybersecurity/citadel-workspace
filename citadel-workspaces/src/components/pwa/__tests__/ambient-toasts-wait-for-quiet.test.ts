/**
 * A capability notice must not land on top of an error.
 *
 * "Ready to work offline" fired the moment the service worker finished, which
 * on a first run is the same moment the user may be reading "Could not reach
 * the server." Measured against an unreachable workspace server, both were on
 * screen together: one saying the connection failed, the other that a
 * connection is not needed — and the second is a green success toast, which on
 * a failed action reads as though something worked.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { announceWhenQuiet, QUIET_WAIT_MS } from '../announce-when-quiet';

describe('an ambient announcement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes out immediately when nothing is wrong', () => {
    const announce: ReturnType<typeof vi.fn> = vi.fn();
    announceWhenQuiet(announce, { isBusy: () => false });
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('waits while an error is on screen', () => {
    const announce: ReturnType<typeof vi.fn> = vi.fn();
    announceWhenQuiet(announce, { isBusy: () => true });
    vi.advanceTimersByTime(3_000);
    expect(announce).not.toHaveBeenCalled();
  });

  it('goes out as soon as the error clears', () => {
    let busy: boolean = true;
    const announce: ReturnType<typeof vi.fn> = vi.fn();
    announceWhenQuiet(announce, { isBusy: () => busy });
    vi.advanceTimersByTime(2_000);
    expect(announce).not.toHaveBeenCalled();
    busy = false;
    vi.advanceTimersByTime(1_000);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting and says it anyway', () => {
    // The notice is true; it was only badly timed. Dropping it would trade a
    // confusing message for a missing one, and an error that never clears
    // would silence the feature for the rest of the session.
    const announce: ReturnType<typeof vi.fn> = vi.fn();
    announceWhenQuiet(announce, { isBusy: () => true });
    vi.advanceTimersByTime(QUIET_WAIT_MS + 100);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('says it once, not once per poll', () => {
    let busy: boolean = true;
    const announce: ReturnType<typeof vi.fn> = vi.fn();
    announceWhenQuiet(announce, { isBusy: () => busy });
    busy = false;
    vi.advanceTimersByTime(QUIET_WAIT_MS * 2);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled, so an unmount does not fire into a dead component', () => {
    const announce: ReturnType<typeof vi.fn> = vi.fn();
    const cancel: () => void = announceWhenQuiet(announce, { isBusy: () => true });
    cancel();
    vi.advanceTimersByTime(QUIET_WAIT_MS * 2);
    expect(announce).not.toHaveBeenCalled();
  });
});
