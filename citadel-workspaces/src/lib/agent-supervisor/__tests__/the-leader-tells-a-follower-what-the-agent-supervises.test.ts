/** The leader answers a follower's question with both capabilities, as the follower's route reads them. */
import { describe, it, expect, beforeEach } from 'vitest';
import { handleAgentCapabilitiesProxy } from '@/lib/multi-instance/leader-proxy-handlers';
import { declareOnLeaderSocket, forgetCapabilities, registerCapabilityRoute, noticesHeard, watchGreeting } from '@/lib/agent-conversations/capabilities';
import { FakeAgent } from './fake-supervising-agent';

beforeEach((): void => {
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
  forgetCapabilities();
});

async function answer(): Promise<unknown> {
  let data: unknown;
  await handleAgentCapabilitiesProxy(
    { senderInstanceId: 'f', requestId: 'r' } as Parameters<typeof handleAgentCapabilitiesProxy>[0],
    ((_to: string, _id: string, _status: string, _error?: string, d?: unknown): void => { data = d; }) as Parameters<typeof handleAgentCapabilitiesProxy>[1],
  );
  return data;
}

describe('the leader\'s answer to a follower', () => {
  it('says the agent supervises when it does', async (): Promise<void> => {
    await new FakeAgent().greet('supervising');
    expect(await answer()).toEqual({ agentIlm: false, supervisesP2p: true, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
  });
  it('says whether a notifier is attached to the agent, as it stands now', async (): Promise<void> => {
    await new FakeAgent().greet('older');
    noticesHeard.set(true);
    expect(await answer()).toEqual({ agentIlm: false, supervisesP2p: false, noticesHeard: true, stagesUploads: false, takesConsole: false, servesApps: false });
  });
  it('says it does not when the agent does not', async (): Promise<void> => {
    await new FakeAgent().greet('older');
    expect(await answer()).toEqual({ agentIlm: false, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
  });
  it('says whether the agent takes console lines', async (): Promise<void> => {
    const greeting: ReturnType<typeof watchGreeting> = watchGreeting();
    greeting.observe({ ServiceConnectionAccepted: { cid: 0n, request_id: null, agent_ilm: false, browser_console: true } });
    await declareOnLeaderSocket({ sendDirectToInternalService: () => Promise.reject(new Error('nothing is declared')), nextResponse: <T,>(): Promise<T> => new Promise<T>(() => undefined) }, greeting);
    expect(await answer()).toMatchObject({ takesConsole: true });
  });
});
