/**
 * The leader always declares on its socket, and every reliable send goes to the
 * agent as `SendReliable`: the agent hosts every account's ILM, so there is no
 * browser messenger to fall back to. A greeting that omits a field changes what
 * the declaration carries, never whether it is made or where a send goes.
 *
 * The socket is a fake client with the two calls the declaration uses; the
 * request path (requests.ts, requestResponse) and MessengerOperations are real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';
import {
  declareOnLeaderSocket, agentSupervisesP2p, forgetCapabilities, watchGreeting, registerCapabilityRoute, noticesHeard,
  type DeclaringClient, type Greeting,
} from '../capabilities';
import { registerConversationSender } from '../requests';
import { MessengerOperations } from '../../websocket/messenger-operations';
import { eventEmitter } from '../../event-emitter';

function greeted(fields: Record<string, unknown>): Greeting {
  const g: Greeting = watchGreeting();
  g.observe({ ServiceConnectionAccepted: { cid: 0n, request_id: null, ...fields } });
  return g;
}

function socket(answer: 'answers' | 'silent'): DeclaringClient & { sent: InternalServiceRequest[] } {
  let match: ((m: InternalServiceResponse) => unknown) | null = null;
  let settle: ((v: unknown) => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  const client: DeclaringClient & { sent: InternalServiceRequest[] } = {
    sent: [] as InternalServiceRequest[],
    async sendDirectToInternalService(request: InternalServiceRequest): Promise<void> {
      client.sent.push(request);
      const id: unknown = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      if (answer === 'silent') { fail?.(new Error('timed out')); return; }
      settle?.(match?.({ AgentCapabilities: { request_id: id, notices_heard: true } } as unknown as InternalServiceResponse));
    },
    nextResponse<T>(extract: (m: InternalServiceResponse) => T | undefined): Promise<T> {
      match = extract;
      return new Promise<T>((resolve, reject) => { settle = resolve as (v: unknown) => void; fail = reject; });
    },
  };
  return client;
}

const declared = (ihttp: boolean): InternalServiceRequest[] =>
  [{ ConnectionManagement: expect.objectContaining({ management_command: { DeclareCapabilities: { capabilities: { ihttp } } } }) }] as InternalServiceRequest[];

beforeEach(() => forgetCapabilities());

describe('the declaration', () => {
  it('is made, carrying ihttp, when the agent serves apps', async () => {
    const s: DeclaringClient & { sent: InternalServiceRequest[] } = socket('answers');
    await declareOnLeaderSocket(s, greeted({ apps: true }));
    expect(s.sent).toEqual(declared(true));
    expect(noticesHeard.get()).toBe(true);
  });

  it('is still made when the greeting omits every capability, with ihttp false', async () => {
    const s: DeclaringClient & { sent: InternalServiceRequest[] } = socket('answers');
    await declareOnLeaderSocket(s, greeted({}));
    expect(s.sent).toEqual(declared(false));
  });

  it('fails the socket, rather than guess, when the agent does not answer', async () => {
    await expect(declareOnLeaderSocket(socket('silent'), greeted({}))).rejects.toThrow('timed out');
  });

  it('answers the leader\'s callers once its socket has declared, and a follower from the leader', async () => {
    registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
    const early: Promise<boolean> = agentSupervisesP2p();
    await declareOnLeaderSocket(socket('answers'), greeted({ supervises_p2p: true }));
    expect(await early).toBe(true);

    forgetCapabilities();
    let asked: number = 0;
    registerCapabilityRoute({ isLeader: () => false, askLeader: async () => { asked += 1; return { supervisesP2p: true, noticesHeard: false, appNotices: false, stagesUploads: false, nativePicker: false, takesConsole: false, servesApps: false, notesToSelf: false }; } });
    expect(await agentSupervisesP2p()).toBe(true);
    expect(await agentSupervisesP2p()).toBe(true);
    expect(asked).toBe(1);
  });
});

describe('a reliable send', () => {
  it('goes to the agent as SendReliable, with no greeting read at all', async () => {
    const asked: Record<string, unknown>[] = [];
    registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
      asked.push(request);
      const body: Record<string, unknown> = request.SendReliable as Record<string, unknown>;
      queueMicrotask(() => eventEmitter.emit('websocket-message', { SendReliableAccepted: { request_id: body.request_id } }));
    });
    const ops: MessengerOperations = new MessengerOperations({ init: async (): Promise<void> => {} });

    await ops.sendP2PMessageReliable(5n, 6n, new Uint8Array([1, 2, 3]), 'High', 'text');
    await ops.sendP2PMessageReliable(5n, 6n, new Uint8Array([4]));

    expect(asked).toEqual([
      { SendReliable: expect.objectContaining({ cid: 5n, peer_cid: 6n, message: [1, 2, 3], security_level: 'High', compression_hint: 'text' }) },
      { SendReliable: expect.objectContaining({ cid: 5n, peer_cid: 6n, message: [4], security_level: 'Standard', compression_hint: null }) },
    ]);
  });
});
