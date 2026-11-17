/**
 * A follower tab has no socket, so it asks the leader what the agent said. The
 * leader's answer says whether the agent supervises, and a follower talking to
 * a leader that predates the capability (a bare boolean) is told it does not.
 * Also: nothing is decided yet is not "supervised" -- until the agent has said,
 * the polls run as they always did.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  agentHostsConversations, agentSupervisesP2p, forgetCapabilities, registerCapabilityRoute, supervision,
} from '@/lib/agent-conversations/capabilities';
import { FakeAgent } from './fake-supervising-agent';

beforeEach((): void => forgetCapabilities());

describe('a follower tab', () => {
  it('learns from the leader that the agent supervises', async (): Promise<void> => {
    registerCapabilityRoute({ isLeader: () => false, askLeader: async () => ({ agentIlm: true, supervisesP2p: true, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false }) });
    expect(await agentSupervisesP2p()).toBe(true);
    expect(await agentHostsConversations()).toBe(true);
    expect(supervision.get()).toBe(true);
  });

  it('learns that it does not, from a leader that says so', async (): Promise<void> => {
    registerCapabilityRoute({ isLeader: () => false, askLeader: async () => ({ agentIlm: true, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false }) });
    expect(await agentSupervisesP2p()).toBe(false);
    expect(supervision.get()).toBe(false);
  });
});

describe('the leader', () => {
  it('has no answer until the agent greets, and then the greeting is the answer', async (): Promise<void> => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    expect(supervision.get()).toBeNull();
    const early: Promise<boolean> = agentSupervisesP2p();
    await new FakeAgent().greet('supervising');
    expect(await early).toBe(true);
    expect(supervision.get()).toBe(true);
  });

  it('forgets the answer with the socket it was for', async (): Promise<void> => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    await new FakeAgent().greet('supervising');
    forgetCapabilities();
    expect(supervision.get()).toBeNull();
  });
});
