import { describe, expect, it } from 'vitest';
import { controlsFor, type Control } from '../controls';
import { alternativesOf, manualPrimary } from '../derive';
import { otherMember } from '../other-member';
import type { OtherMember } from '../binding';
import type { RecoveryPlan } from '../route';
import { stepsOf } from '../steps';
import { planOf } from '../plan-of';
import { recordingPorts } from './fake-ports';

const ours: RecoveryPlan = { cause: 'ours', presentation: 'toast', primary: { kind: 'retry' }, alternatives: [] };

describe('a plan becomes controls', () => {
  it('offers a bug report on every failure that is ours, without the plan listing one', () => {
    expect(alternativesOf(ours)).toEqual([{ kind: 'report-bug' }]);
    expect(alternativesOf({ ...ours, cause: 'environment' })).toEqual([]);
  });

  it('does not offer the bug report twice when the plan already leads with it', () => {
    expect(alternativesOf({ ...ours, primary: { kind: 'report-bug' } })).toEqual([]);
  });

  it('puts a wait\'s fallback first among the controls a person presses', () => {
    const plan: RecoveryPlan = planOf('session.agent-unreachable');
    expect(manualPrimary(plan)).toEqual({ kind: 'install-agent', reason: 'missing' });
    expect(stepsOf(plan.primary)).toBe(3);
  });

  it('runs a retry through the binding and a reload through the ports', async () => {
    const { ports, calls } = recordingPorts({ kind: 'sent', admins: 2 });
    let retried: number = 0;
    const controls: readonly Control[] = controlsFor(ours, { retry: async (): Promise<void> => { retried += 1; } }, ports, 'action.failed');
    expect(controls.map((c: Control): string => c.label)).toEqual(['Try again', 'Report this problem']);
    await controls[0].run();
    await controls[1].run();
    expect(retried).toBe(1);
    expect(calls).toEqual([{ port: 'reportBug', args: ['action.failed'] }]);
  });

  it('says where an ask went, in the words the asker reads', async () => {
    const { ports, calls } = recordingPorts({ kind: 'sent', admins: 2 });
    const [ask] = controlsFor(planOf('apps.Unavailable'), { askAbout: 'synchronized.work' }, ports, 'apps.Unavailable');
    expect(ask.label).toBe('Ask an admin');
    expect(await ask.run()).toBe('Sent to 2 admins. It is in their Scratchpads.');
    expect(calls[0]).toEqual({ port: 'askAdmins', args: ['app-access', 'synchronized.work'] });
  });

  it('fails loudly when a binding lacks what its route needs, rather than rendering a dead button', () => {
    const { ports } = recordingPorts({ kind: 'sent', admins: 1 });
    expect((): readonly Control[] => controlsFor(ours, {}, ports, 'action.failed')).toThrow(/needs the binding's retry/);
  });

  it('names the member a message goes to', () => {
    const { ports } = recordingPorts({ kind: 'sent', admins: 1 });
    const member: OtherMember | null = otherMember(7n, 1n, 'ada');
    if (member === null) throw new Error('a different cid is another member');
    const [message] = controlsFor(planOf('topic.refused'), { member, draft: 'hello', retry: async (): Promise<void> => undefined }, ports, 'topic.refused');
    expect(message.label).toBe('Message ada');
  });
});

describe('otherMember', () => {
  it('refuses the viewer themself, so nobody waits on themself', () => {
    expect(otherMember(5n, 5n, 'me')).toBeNull();
    expect(otherMember(6n, 5n, null)?.cid).toBe(6n);
  });
});
