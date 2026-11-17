/**
 * The leader declares agent hosting on its socket; what the agent answers
 * decides whether this browser runs an ILM at all. Whether to declare comes
 * from the agent's greeting, so an older agent -- which never answers a
 * declaration -- costs no wait at all.
 *
 * An agent that hosts the account gets every reliable send as `SendReliable`
 * and no browser messenger is ever opened: a browser ILM beside the agent's
 * would split the per-source frontier. An agent that predates hosting does not
 * answer, and the browser path stays.
 *
 * The socket is a fake client with the two calls the declaration uses; the
 * request path (requests.ts, requestResponse) and MessengerOperations are real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { InternalServiceRequest, InternalServiceResponse, WorkspaceClient } from 'citadel-workspace-client-ts';
import {
  declareOnLeaderSocket, agentHostsConversations, forgetCapabilities, watchGreeting, registerCapabilityRoute,
  type DeclaringClient, type Greeting,
} from '../capabilities';
import { registerConversationSender } from '../requests';
import { MessengerOperations } from '../../websocket/messenger-operations';
import { eventEmitter } from '../../event-emitter';

/** A greeting as an agent sends it; an older agent's has no `agent_ilm`. */
function greeted(offers: boolean | 'older'): Greeting {
  const g: Greeting = watchGreeting();
  g.observe({ ServiceConnectionAccepted: offers === 'older' ? { cid: 0n, request_id: null } : { cid: 0n, request_id: null, agent_ilm: offers } });
  return g;
}

function socket(agentIlm: boolean | 'silent'): DeclaringClient & { sent: InternalServiceRequest[] } {
  let match: ((m: InternalServiceResponse) => unknown) | null = null;
  let settle: ((v: unknown) => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  const client: DeclaringClient & { sent: InternalServiceRequest[] } = {
    sent: [] as InternalServiceRequest[],
    async sendDirectToInternalService(request: InternalServiceRequest): Promise<void> {
      client.sent.push(request);
      const id: unknown = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      if (agentIlm === 'silent') { fail?.(new Error('timed out')); return; }
      settle?.(match?.({ AgentCapabilities: { request_id: id, agent_ilm: agentIlm } } as unknown as InternalServiceResponse));
    },
    nextResponse<T>(extract: (m: InternalServiceResponse) => T | undefined): Promise<T> {
      match = extract;
      return new Promise<T>((resolve, reject) => { settle = resolve as (v: unknown) => void; fail = reject; });
    },
  };
  return client;
}

/** A leader client that must not be used: the agent carries these. */
const untouchable: WorkspaceClient = {
  sendP2PMessageReliable: (): never => { throw new Error('the browser ILM was used'); },
  openMessengerFor: (): never => { throw new Error('a browser messenger was opened'); },
  ensureMessengerOpen: (): never => { throw new Error('a browser messenger was opened'); },
} as unknown as WorkspaceClient;

beforeEach(() => forgetCapabilities());

describe('declaring agent hosting', () => {
  it('declares on the leader socket when the agent offers, and believes the answer', async () => {
    const s: DeclaringClient & { sent: InternalServiceRequest[] } = socket(true);
    expect(await declareOnLeaderSocket(s, greeted(true))).toBe(true);
    expect(s.sent).toEqual([{ ConnectionManagement: expect.objectContaining({ management_command: { DeclareCapabilities: { capabilities: { agent_ilm: true } } } }) }]);
    expect(await agentHostsConversations()).toBe(true);
  });

  it('declares that this window takes P2P internal-HTTP frames when the agent serves apps (control: not otherwise)', async () => {
    const g: Greeting = watchGreeting();
    g.observe({ ServiceConnectionAccepted: { cid: 0n, request_id: null, agent_ilm: true, apps: true } });
    const s: DeclaringClient & { sent: InternalServiceRequest[] } = socket(true);
    expect(await declareOnLeaderSocket(s, g)).toBe(true);
    expect(s.sent).toEqual([{ ConnectionManagement: expect.objectContaining({ management_command: { DeclareCapabilities: { capabilities: { agent_ilm: true, ihttp: true } } } }) }]);
  });

  it('does not declare at all to an agent whose greeting offers nothing', async () => {
    for (const offers of ['older', false] as const) {
      forgetCapabilities();
      const s: DeclaringClient & { sent: InternalServiceRequest[] } = socket('silent');
      expect(await declareOnLeaderSocket(s, greeted(offers))).toBe(false);
      expect(s.sent).toEqual([]);
    }
  });

  it('keeps the browser path when the agent offers and then declines', async () => {
    expect(await declareOnLeaderSocket(socket(false), greeted(true))).toBe(false);
  });

  it('fails the socket, rather than guess, when an agent that offered does not answer', async () => {
    await expect(declareOnLeaderSocket(socket('silent'), greeted(true))).rejects.toThrow('timed out');
  });

  it('answers the leader\'s callers once its socket has declared, and a follower from the leader', async () => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    const early: Promise<boolean> = agentHostsConversations();
    await declareOnLeaderSocket(socket(true), greeted(true));
    expect(await early).toBe(true);

    forgetCapabilities();
    let asked: number = 0;
    registerCapabilityRoute({ isLeader: () => false, askLeader: async () => { asked += 1; return { agentIlm: true, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false }; } });
    expect(await agentHostsConversations()).toBe(true);
    expect(await agentHostsConversations()).toBe(true);
    expect(asked).toBe(1);
  });
});

describe('reliable sends when the agent hosts the account', () => {
  it('go to the agent as SendReliable, and no browser messenger opens', async () => {
    await declareOnLeaderSocket(socket(true), greeted(true));
    const asked: Record<string, unknown>[] = [];
    registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
      asked.push(request);
      const body: Record<string, unknown> = request.SendReliable as Record<string, unknown>;
      queueMicrotask(() => eventEmitter.emit('websocket-message', { SendReliableAccepted: { request_id: body.request_id } }));
    });
    const ops: MessengerOperations = new MessengerOperations({ init: async (): Promise<void> => {}, getClient: (): WorkspaceClient => untouchable });

    await ops.openMessengerFor(5n);
    expect(await ops.ensureMessengerOpen(5n)).toBe(false);
    await ops.sendP2PMessageReliable(5n, 6n, new Uint8Array([1, 2, 3]), 'High', 'text');

    expect(asked).toEqual([{
      SendReliable: expect.objectContaining({ cid: 5n, peer_cid: 6n, message: [1, 2, 3], security_level: 'High', compression_hint: 'text' }),
    }]);
  });
});
