/**
 * The wizard's optional fields are sent after the account exists, and nothing
 * about them may undo, block or silently lose the registration.
 *
 * The effects are injected (waitForWorkspace / send / reportFailure), so the
 * real plan-and-apply code runs here with no event bus, socket or toast. Those
 * three stand-ins are the whole of the mocking, and each is the I/O boundary.
 */
import { describe, it, expect } from 'vitest';
import {
  applySignupProfile,
  planSignupProfileUpdate,
  type SignupProfileEffects,
  type SignupProfilePlan,
} from '../signup-profile';
import type { ProfileUpdate } from '../workspace-service/messaging-operations';

const BLANK: { avatarData: null; email: string; title: string } = { avatarData: null, email: '', title: '' };

interface Recorder {
  effects: SignupProfileEffects;
  sent: ProfileUpdate[];
  failures: string[];
  order: string[];
}

function recorder(opts: { workspace: 'loads' | 'never'; send: 'ok' | 'refused' }): Recorder {
  const r: Recorder = { sent: [], failures: [], order: [], effects: undefined as unknown as SignupProfileEffects };
  r.effects = {
    waitForWorkspace: async (): Promise<void> => {
      r.order.push('wait');
      if (opts.workspace === 'never') throw new Error('the workspace did not finish loading');
    },
    send: async (update: ProfileUpdate): Promise<void> => {
      r.order.push('send');
      r.sent.push(update);
      if (opts.send === 'refused') throw new Error('Failed to update user profile: User not found');
    },
    reportFailure: (description: string): void => {
      r.failures.push(description);
    },
  };
  return r;
}

describe('planning the post-registration profile update', () => {
  it('sends nothing when nothing optional was filled in', () => {
    expect(planSignupProfileUpdate(BLANK)).toEqual({ update: null, skipped: [] });
    expect(planSignupProfileUpdate({ avatarData: null, email: '   ', title: ' ' }).update).toBeNull();
  });

  it('sends exactly what was provided, trimmed', () => {
    const plan: SignupProfilePlan = planSignupProfileUpdate({
      avatarData: 'UklGR',
      email: ' ada@example.com ',
      title: ' Engineer ',
    });
    expect(plan).toEqual({
      update: { avatarData: 'UklGR', email: 'ada@example.com', title: 'Engineer' },
      skipped: [],
    });
  });

  it('never sends an empty email or title, which the server reads as "clear"', () => {
    const plan: SignupProfilePlan = planSignupProfileUpdate({ avatarData: 'UklGR', email: '', title: '' });
    expect(plan.update).toEqual({ avatarData: 'UklGR' });
    expect(plan.update).not.toHaveProperty('email');
    expect(plan.update).not.toHaveProperty('title');
  });

  it('leaves out a value the server would refuse, and names it', () => {
    const plan: SignupProfilePlan = planSignupProfileUpdate({ avatarData: null, email: 'not-an-email', title: 'Engineer' });
    expect(plan.update).toEqual({ title: 'Engineer' });
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatch(/^email/);
  });
});

describe('applying it', () => {
  it('waits for the workspace, then sends once', async () => {
    const r: Recorder = recorder({ workspace: 'loads', send: 'ok' });
    await applySignupProfile(planSignupProfileUpdate({ ...BLANK, title: 'Engineer' }), r.effects);
    expect(r.order).toEqual(['wait', 'send']);
    expect(r.sent).toEqual([{ title: 'Engineer' }]);
    expect(r.failures).toEqual([]);
  });

  it('does nothing at all when there is nothing to send', async () => {
    const r: Recorder = recorder({ workspace: 'loads', send: 'ok' });
    await applySignupProfile(planSignupProfileUpdate(BLANK), r.effects);
    expect(r.order).toEqual([]);
    expect(r.failures).toEqual([]);
  });

  it('reports a refusal instead of throwing', async () => {
    const r: Recorder = recorder({ workspace: 'loads', send: 'refused' });
    await expect(
      applySignupProfile(planSignupProfileUpdate({ ...BLANK, email: 'ada@example.com' }), r.effects),
    ).resolves.toBeUndefined();
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('User not found');
    expect(r.failures[0]).toContain('Settings > General');
  });

  it('does not send, and says so, when the session never reaches the workspace', async () => {
    const r: Recorder = recorder({ workspace: 'never', send: 'ok' });
    await applySignupProfile(planSignupProfileUpdate({ ...BLANK, email: 'ada@example.com' }), r.effects);
    expect(r.sent).toEqual([]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('did not finish loading');
  });

  it('reports a skipped field even when nothing else is sent', async () => {
    const r: Recorder = recorder({ workspace: 'loads', send: 'ok' });
    await applySignupProfile(planSignupProfileUpdate({ ...BLANK, email: 'nope' }), r.effects);
    expect(r.sent).toEqual([]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/Not saved: email/);
  });
});
