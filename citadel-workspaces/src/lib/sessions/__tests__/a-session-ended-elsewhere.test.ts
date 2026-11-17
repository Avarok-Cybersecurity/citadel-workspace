/**
 * Which notices mean "this account ended in another window", and how a window
 * leaves when it did: asked first about unsaved editor text, told why.
 */
import { describe, it, expect } from 'vitest';
import { endingHereWhile } from '../ending-here';
import { endedElsewhere, endedMessage } from '../session-ended';
import { leaveEndedSession, type LeaveIO } from '../leave-ended-session';

const out = (cid: bigint, peer: bigint | null | undefined): Record<string, unknown> =>
  ({ DisconnectNotification: { cid, peer_cid: peer, request_id: null } });

describe('a session ended elsewhere', () => {
  it('is a sign-out or a deletion of the session itself', () => {
    expect(endedElsewhere(out(7n, null))).toEqual({ cid: 7n, reason: 'signed-out' });
    expect(endedElsewhere(out(7n, undefined))).toEqual({ cid: 7n, reason: 'signed-out' });
    expect(endedElsewhere({ Response: { DeregisterSuccess: { cid: 7n, request_id: null } } })).toEqual({ cid: 7n, reason: 'deleted' });
  });

  it('is not a peer going away, nor anything else', () => {
    expect(endedElsewhere(out(7n, 9n))).toBeNull();
    expect(endedElsewhere({ ConnectSuccess: { cid: 7n } })).toBeNull();
  });

  it('is not this window\'s own sign-out answering it', async () => {
    let heard: unknown = 'not asked';
    await endingHereWhile(7n, async () => { heard = endedElsewhere(out(7n, null)); });
    expect(heard).toBeNull();
    expect(endedElsewhere(out(7n, null))).not.toBeNull();
  });

  it('names the account and what happened', () => {
    expect(endedMessage('alice', 'signed-out')).toBe('alice was signed out in another window.');
    expect(endedMessage('alice', 'deleted')).toBe('alice was deleted in another window.');
  });
});

describe('leaving it', () => {
  function rig(mayLeave: boolean): { io: LeaveIO; steps: string[] } {
    const steps: string[] = [];
    return {
      steps,
      io: {
        mayLeave: async (): Promise<boolean> => { steps.push('asked'); return mayLeave; },
        navigate: (path: string): void => { steps.push(`went to ${path}`); },
        tell: (message: string, stayed: boolean): void => { steps.push(`${stayed ? 'stayed' : 'told'}: ${message}`); },
      },
    };
  }

  it('goes to the landing page and says why', async () => {
    const { io, steps } = rig(true);
    await leaveEndedSession(io, '/', 'alice was signed out in another window.');
    expect(steps).toEqual(['asked', 'told: alice was signed out in another window.', 'went to /']);
  });

  it('stays, with the text to copy, when the user keeps unsaved edits', async () => {
    const { io, steps } = rig(false);
    await leaveEndedSession(io, '/', 'alice was signed out in another window.');
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatch(/^stayed: alice was signed out in another window\. Your unsaved text is still here/);
  });
});
