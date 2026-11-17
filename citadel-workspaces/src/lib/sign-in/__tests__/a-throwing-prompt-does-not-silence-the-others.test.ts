// @vitest-environment node
/**
 * The challenge watch's subscribers are isolated: one that throws neither
 * stops the others hearing of a challenge nor unwinds into the message bus
 * that delivered it (the parent's check-listener-fanouts-are-isolated rule).
 * No doubles: the real bus and the real watch.
 */
import { describe, expect, it } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { openChallenges, subscribeChallenges, watchKeyChallenges } from '../challenge-watch';

describe('challenge subscribers', () => {
  it('all hear of a challenge even when one throws', () => {
    const unwatch: () => void = watchKeyChallenges('r-iso');
    const heard: string[] = [];
    const stopThrower: () => void = subscribeChallenges((): void => { throw new Error('a broken prompt'); });
    const stopListener: () => void = subscribeChallenges((): void => { heard.push('second'); });
    expect(() => eventEmitter.emit('websocket-message', { SecurityKeyChallengeNotification: {
      cid: 0n, request_id: 'r-iso', challenge_id: 'c-iso', purpose: 'SignIn', allowed_credential_ids: [[1]], prf_salt: [2], expires_in_ms: 60000,
    } })).not.toThrow();
    expect(heard).toEqual(['second']);
    expect(openChallenges().map((c) => c.challenge_id)).toEqual(['c-iso']);
    stopThrower(); stopListener(); unwatch();
  });
});
