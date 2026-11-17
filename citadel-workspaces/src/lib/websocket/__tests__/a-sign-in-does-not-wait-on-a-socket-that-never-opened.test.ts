/**
 * A leader tab whose socket never opens answers "which sign-in?" with that
 * failure, instead of never answering.
 *
 * TakeoverSignIn asks `agentHostsConversations()` whether to offer "open it
 * here too" or the password form, and renders nothing until it hears. On the
 * leader that answer comes from its own socket's declaration -- which a socket
 * that fails to open never makes. The question stayed pending for good, and
 * the sign-in dialog was blank with nothing to press. The failure to open is
 * the event that ends the wait; TakeoverSignIn already turns a failed answer
 * into the password form, whose submit reports the unreachable agent.
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
import { agentHostsConversations, registerCapabilityRoute } from '../../agent-conversations/capabilities';
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

describe('the leader asked which sign-in, before its socket opened', () => {
  it('hears that the socket failed, when it fails to open', async () => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    const question: Promise<boolean> = agentHostsConversations();

    await expect(leaderTab().createWebSocketAsLeader()).rejects.toThrow('ConnectionFailed');

    await expect(question).rejects.toThrow('ConnectionFailed { code: 1006 }');
  });

  it('asks the next socket afresh, rather than remembering the failure', async () => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    await expect(leaderTab().createWebSocketAsLeader()).rejects.toThrow('ConnectionFailed');

    const next: Promise<boolean> = agentHostsConversations();
    // The next socket opens, to an agent that does not host conversations.
    await greetAs('older');
    expect(await next).toBe(false);
  });
});
