/**
 * Signing out of a session that has no identifier must say so, not succeed.
 *
 * `ActiveSession.cid` is declared `bigint` and is not always present. The
 * session loader already guards `sel?.cid !== undefined` for that reason; the
 * disconnect path did not, so `websocketService.disconnect(undefined)` was
 * called, the loading modal ran through to "ready", and the session was still
 * in the strip afterwards.
 *
 * CI found it the moment round 281 made the confirm button pressable again:
 *
 *   [OrphanSessionsNavbar] Disconnecting session: undefined
 *   prev_sess_b still in navbar: true
 *
 * Three checks failing on an action that reported success -- which is the worst
 * of the two ways to fail, because the user is told it worked.
 */
import { describe, it, expect } from 'vitest';
import { disconnectRefusal, signOutRefusal } from '../orphan-session-disconnect';
import { SESSION_OWNED_ELSEWHERE } from '@/lib/sessions/claim-session';

describe('signing out of a session', () => {
  it('is refused, with a reason, when the session has no CID', () => {
    const refusal: string | null = disconnectRefusal(undefined);

    expect(refusal, 'a missing CID must produce a refusal').not.toBeNull();
    // Something a person can act on, not "an error occurred".
    expect(refusal).toContain('cannot be signed out');
    expect(refusal).toContain('Reload');
  });

  it('is allowed when there is one', () => {
    // The positive control. Without it, "refuses when there is no CID" is
    // satisfied by a function that refuses everything -- and nobody could sign
    // out of anything.
    expect(disconnectRefusal(42n)).toBeNull();
  });

  it('is allowed for CID zero, which is a CID', () => {
    // `0n` is falsy. A guard written as `if (!cid)` would refuse it, and the
    // one thing worse than signing out of nothing is refusing to sign out of
    // something.
    expect(disconnectRefusal(0n)).toBeNull();
  });
});

describe('signing out a session this connection does not own', () => {
  it('refuses when another tab has it', () => {
    // The one case where refusing is right: somebody is using it.
    expect(signOutRefusal({ status: 'owned-by-another-tab', instanceId: 'tab-2' })).toBe(
      SESSION_OWNED_ELSEWHERE.description,
    );
  });

  it('proceeds once the claim succeeded', () => {
    // Claiming is what makes the service's ownership gate permit the
    // Disconnect. Without it the request was refused every time -- in silence
    // until round 309, and with an honest message after it.
    expect(signOutRefusal({ status: 'claimed' })).toBeNull();
  });

  it('proceeds for a live session no tab of this browser holds', () => {
    // The service answers for itself if it disagrees; guessing on its behalf
    // here would refuse sign-outs that would have worked.
    expect(signOutRefusal({ status: 'already-active' })).toBeNull();
  });
});
