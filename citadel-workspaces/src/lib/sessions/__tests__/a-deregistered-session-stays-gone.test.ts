/**
 * "Deregister Removes: FAIL" beside "Deregister Permanent: PASS".
 *
 * That pair says the row was gone after a reload and still on screen before
 * one. `sign-out-session` already removes it LAST, after its own reload, and
 * its comment explains why — a list fetched a moment after a deregistration can
 * still contain the session. That is enough against the one reload it performs
 * and no help at all against the next one, which arrives on its own:
 * deregistering stops the WASM client, and the reconnection fires
 * `on-ws-connection-success`, which reloads the list from the same server.
 *
 * So the removal needs to outlive the function that performed it, until the
 * server stops reporting the session. A tombstone, not a timeout: the condition
 * is "the server still says this exists", so the thing to wait on is the server
 * no longer saying it.
 *
 * Bounded, though, and bounded by TIME. The first version waited for absence
 * and nothing else, which hides a live session for ever when the
 * deregistration fails. The second counted lists, and CI showed the row
 * returning anyway: lists arrive in bursts -- the removal performs one, the
 * reconnection it causes performs another, the navbar refreshes on its own --
 * so three passed in about a second while the server was still propagating a
 * deletion. The bound expired before the condition could resolve, because it
 * counted the wrong unit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  forgetSession,
  isForgotten,
  reconcileForgotten,
  rememberEverything,
  useClock,
} from '../forgotten-sessions';

describe('a session this tab deregistered', () => {
  beforeEach((): void => { rememberEverything(); });

  it('stays hidden while the server still lists it', () => {
    forgetSession(7n);
    // The reload that the reconnection triggers, answering from a connection
    // map the deregistration has not reached yet.
    reconcileForgotten([7n, 9n]);

    expect(isForgotten(7n)).toBe(true);
    expect(isForgotten(9n)).toBe(false);
  });

  it('stops being hidden once the hold expires', () => {
    // The positive control: a tombstone that never expires hides a CID for the
    // life of the tab, and CIDs are permanent, so the same account logging back
    // in would be invisible.
    //
    // This used to assert that a single absence ended it. That was the bug --
    // see 'a list that omits the session and then carries it again' below --
    // so the release is by time, which is the only thing that settles.
    let clock: number = 1_000;
    useClock((): number => clock);
    forgetSession(7n);
    reconcileForgotten([9n]);
    expect(isForgotten(7n), 'one absence does not release it').toBe(true);

    clock += 31_000;
    reconcileForgotten([9n]);
    expect(isForgotten(7n)).toBe(false);
  });

  it('hides nothing by default', () => {
    reconcileForgotten([7n]);
    expect(isForgotten(7n)).toBe(false);
  });

  it('survives a burst of lists, which is what defeated the count-based bound', () => {
    // The removal reloads, the reconnection it causes reloads, and the navbar
    // refreshes -- three lists in about a second, while the server is still
    // propagating the deletion. A bound of three lists expired here; a bound
    // measured in time does not.
    let clock: number = 1_000;
    useClock((): number => clock);
    forgetSession(7n);

    for (let i: number = 0; i < 5; i += 1) {
      clock += 200;
      reconcileForgotten([7n]);
    }

    expect(isForgotten(7n)).toBe(true);
  });

  it('gives up once the server has insisted for long enough', () => {
    // A deregistration that failed server-side. Hiding a live session for the
    // life of the tab is the worse of the two errors, so the tombstone yields.
    let clock: number = 1_000;
    useClock((): number => clock);
    forgetSession(7n);

    clock += 29_000;
    reconcileForgotten([7n]);
    expect(isForgotten(7n), 'still hiding before the bound').toBe(true);

    clock += 2_000;
    reconcileForgotten([7n]);
    expect(isForgotten(7n), 'given up after it').toBe(false);
  });
});

describe('a list that omits the session and then carries it again', () => {
  it('keeps hiding it, because one absence is not the server agreeing', () => {
    // The reload straight after a deregister often omits the session, and
    // dropping the tombstone there is what let the row come back: a later
    // query answered from a staler view carries it again, and by then nothing
    // was hiding it. CI said "Deregister Removes: FAIL" beside "Deregister
    // Permanent: PASS" -- gone from the server, still on screen.
    let clock: number = 1_000;
    useClock((): number => clock);
    forgetSession(7n);

    clock += 200;
    reconcileForgotten([]);      // absent this time
    clock += 200;
    reconcileForgotten([7n]);    // and back in the next answer

    expect(isForgotten(7n)).toBe(true);
  });

  it('still gives up on time, so a failed deregister is not hidden for ever', () => {
    // Positive control: removing the early drop must not make the tombstone
    // permanent.
    let clock: number = 1_000;
    useClock((): number => clock);
    forgetSession(7n);

    clock += 31_000;
    reconcileForgotten([7n]);
    expect(isForgotten(7n)).toBe(false);
  });
});
