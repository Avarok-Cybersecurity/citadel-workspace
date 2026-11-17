/**
 * Three answers, not two: reachable, not reachable, and we could not find out.
 *
 * The peer list is `null` until discovery succeeds. Treating that as "this
 * person has never appeared" tells somebody their colleague "needs to be online
 * at least once before a request can be sent" — sending them to wait for
 * something that has probably already happened, when the truth is that we could
 * not ask.
 */
import { describe, it, expect } from 'vitest';
import { reachablePeer } from '../reachable-peer';
import type { Peer } from '@/components/p2p/usePeerDiscovery';

const ALICE: Peer = { cid: '7', username: 'alice', is_online: true } as Peer;
const MEMBER: { id: string; displayName: string } = { id: 'alice', displayName: 'Alice Chen' };

describe('resolving a directory member to a peer', () => {
  it('finds them when discovery has run and they are there', () => {
    expect(reachablePeer([ALICE], MEMBER).username).toBe('alice');
  });

  it('says the list did not load, not that they have never appeared', () => {
    expect(() => reachablePeer(null, MEMBER)).toThrow(/could not be loaded/i);
    expect(() => reachablePeer(null, MEMBER)).not.toThrow(/need to be online/i);
  });

  it('still says they have never appeared when the list DID load without them', () => {
    // The positive control. Without it, always reporting "could not be loaded"
    // would satisfy the test above — and a member who genuinely has never come
    // online needs the sentence that tells them to wait.
    expect(() => reachablePeer([], MEMBER)).toThrow(/need to be online/i);
    expect(() => reachablePeer([], MEMBER)).not.toThrow(/could not be loaded/i);
  });

  it('names the person in the not-yet-reachable message', () => {
    expect(() => reachablePeer([], MEMBER)).toThrow(/Alice Chen/);
  });
});
