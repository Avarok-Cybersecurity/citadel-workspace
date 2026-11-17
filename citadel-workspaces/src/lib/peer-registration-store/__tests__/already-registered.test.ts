import { describe, it, expect } from 'vitest';
import { isAlreadyRegistered } from '@/lib/peer-registration-store/already-registered';

/**
 * The agent sends TWO messages containing "is already registered", and they
 * mean opposite things.
 *
 * A failed peer-list read answers "Could not determine whether N is already
 * registered: <err>. Nothing was changed; try again." -- correctly refusing to
 * guess. The substring test read that as success, and five consumers acted on
 * it: the accept-matcher resolved and the lifecycle connected to an
 * unregistered peer, the outgoing retry record was deleted, the discovery row
 * was marked, and `p2p:peer-registered` was emitted, which auto-connect turned
 * into `addOnlinePeer`. The connect then failed into a debugLog compiled out of
 * production.
 *
 * `check-already-registered-predicate-matches-the-agent.mjs` runs EVERY
 * PeerRegisterFailure message the Rust can emit through this predicate and
 * asserts exactly one reads as success. These tests pin the two known ones, so
 * the intent is readable next to the code as well as enforced across the repos.
 */
describe('the already-registered predicate', () => {
  it('accepts the real thing', () => {
    expect(isAlreadyRegistered('Peer 99 is already registered')).toBe(true);
  });

  it('rejects a message that could NOT determine the answer', () => {
    expect(
      isAlreadyRegistered(
        'Could not determine whether 99 is already registered: Timeout. Nothing was changed; try again.',
      ),
      'refusing to guess is not the same as having determined it',
    ).toBe(false);
  });

  it('rejects a genuine refusal', () => {
    expect(isAlreadyRegistered('no such peer')).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isAlreadyRegistered(undefined)).toBe(false);
  });
});
