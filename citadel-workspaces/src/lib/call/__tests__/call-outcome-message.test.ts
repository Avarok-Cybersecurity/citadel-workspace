/**
 * The reducer records a reason on every terminal state and CallState.reason is
 * documented as being there "for the UI to explain itself" — but both call
 * surfaces hide the `ended` status, so declined, busy, no-microphone and 45
 * seconds unanswered all presented identically: the outgoing panel silently
 * vanished. `no-devices` is the case that matters most, since the callee's
 * client sends it precisely so the caller knows to try another way.
 */
import { describe, it, expect } from 'vitest';
import { callOutcomeMessage, callOutcomePeerName } from '../call-outcome-message';
import type { CallState, CallParticipant } from '../call-state';

describe('callOutcomeMessage', () => {
  it('distinguishes every outcome the caller cannot otherwise tell apart', () => {
    const said: (string | null)[] = ['rejected', 'busy', 'no-devices', 'unsupported', 'unanswered'].map((r): string | null =>
      callOutcomeMessage(r, 'Ada'),
    );

    expect(said.every((m) => m && m.includes('Ada'))).toBe(true);
    // All different: the whole point is that they were indistinguishable.
    expect(new Set(said).size).toBe(said.length);
  });

  it('names the microphone case explicitly rather than looking like a snub', () => {
    expect(callOutcomeMessage('no-devices', 'Ada')).toMatch(/microphone/i);
  });

  it('stays silent on a normal hangup', () => {
    expect(callOutcomeMessage('hangup', 'Ada')).toBeNull();
  });

  it('stays silent on a reason this build does not recognise', () => {
    // Better nothing than "the call ended because it ended".
    expect(callOutcomeMessage('some-future-reason', 'Ada')).toBeNull();
    expect(callOutcomeMessage(null, 'Ada')).toBeNull();
  });
});

const participant = (over: Partial<CallParticipant>): CallParticipant =>
  ({ cid: 2n, username: '', status: 'invited', media: {}, speaking: false, ...over }) as CallParticipant;

const state = (participants: CallParticipant[]): CallState =>
  ({ participants: new Map(participants.map((p) => [p.cid, p])) }) as CallState;

describe('callOutcomePeerName', () => {
  it('uses the peer username', () => {
    expect(callOutcomePeerName(state([participant({ username: 'Ada' })]))).toBe('Ada');
  });

  it('never falls back to a raw CID', () => {
    const name: string = callOutcomePeerName(state([participant({ cid: 123456789n, username: '' })]));
    expect(name).not.toMatch(/\d/);
  });
});
