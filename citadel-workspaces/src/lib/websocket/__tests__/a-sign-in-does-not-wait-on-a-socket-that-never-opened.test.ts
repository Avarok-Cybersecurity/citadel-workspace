/**
 * A leader tab whose socket never opens answers "what does the agent offer?"
 * with that failure, instead of never answering.
 *
 * On the leader that answer comes from its own socket's declaration -- which a
 * socket that fails to open never makes. A question asked before then (whether
 * the agent supervises peer links, stages uploads, takes console lines) stayed
 * pending for good. The failure to open is the event that ends the wait.
 *
 * The real `WebSocketInitialization` and capability module; only the WASM
 * client is faked (vitest cannot run the WASM module), as an agent that is not
 * listening: `init()` throws the error the WASM client throws then.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../multi-instance', () => ({
  instanceManager: { isLeader: true, leaderId: 'leader', instanceId: 'leader' },
  leaderOutboundHandler: { setWebSocketSendFunction: vi.fn() },
  instanceChannel: { send: vi.fn() },
}));
vi.mock('../leader-inbound-handler', () => ({
  leaderInboundHandler: (h?: (m: unknown) => void) => (m: unknown): void => { h?.(m); },
}));
vi.mock('citadel-workspace-client-ts', () => ({
  WorkspaceClient: class {
    async init(): Promise<void> { throw new Error('WebSocket connection failed: ConnectionFailed { code: 1006 }'); }
  },
}));

import { WebSocketInitialization } from '../initialization';
import { ReconnectBackoff, systemClock, AGENT_RECONNECT_BACKOFF } from '../reconnect-backoff';
import { agentSupervisesP2p, registerCapabilityRoute } from '../../agent-conversations/capabilities';
import { greetAs } from '../../agent-conversations/__tests__/agent-greeting';

function leaderTab(): WebSocketInitialization {
  const init: WebSocketInitialization = new WebSocketInitialization({
    websocketUrl: 'ws://agent.test/ws',
    onClientCreated: (): void => {},
    onClientReset: (): void => {},
    releaseSession: (): void => {},
    reconnectBackoff: new ReconnectBackoff(AGENT_RECONNECT_BACKOFF, systemClock),
    reopen: () => init.createWebSocketAsLeader(),
  });
  return init;
}

describe('the leader asked what the agent offers, before its socket opened', () => {
  it('hears that the socket failed, when it fails to open', async () => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    const question: Promise<boolean> = agentSupervisesP2p();

    await expect(leaderTab().createWebSocketAsLeader()).rejects.toThrow('ConnectionFailed');

    await expect(question).rejects.toThrow('ConnectionFailed { code: 1006 }');
  });

  it('asks the next socket afresh, rather than remembering the failure', async () => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    await expect(leaderTab().createWebSocketAsLeader()).rejects.toThrow('ConnectionFailed');

    const next: Promise<boolean> = agentSupervisesP2p();
    // The next socket opens, to an agent that supervises.
    await greetAs({ supervises_p2p: true });
    expect(await next).toBe(true);
  });
});
