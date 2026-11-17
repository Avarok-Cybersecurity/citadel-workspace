/**
 * The compression hint reaches the WASM client from either kind of tab.
 *
 * A leader calls its client directly; a follower's send crosses a
 * BroadcastChannel as a proxy request and the leader's handler makes the call.
 * The hint has to survive that crossing, and one that is not a hint the WASM
 * client knows is refused at the leader rather than forwarded.
 *
 * Stood in: which tab leads, the BroadcastChannel (a recorder that hands the
 * follower's request to the real leader handler), and the WASM client (a
 * recorder). MessengerOperations and the leader's proxy handler are real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const role: { isLeader: boolean } = { isLeader: true };
const toLeader: Array<Record<string, unknown>> = [];
vi.mock('../../multi-instance', () => ({
  instanceManager: {
    get isLeader(): boolean { return role.isLeader; },
    instanceId: 'this-tab',
  },
  instanceChannel: {
    sendToLeader: async (request: Record<string, unknown>): Promise<{ status: 'processed' }> => {
      toLeader.push(request);
      return { status: 'processed' };
    },
  },
  instanceInboundRouter: { registerPendingRequest: (): void => {} },
}));

const clientCalls: unknown[][] = [];
const client: { sendP2PMessageReliable: (...args: unknown[]) => Promise<void> } = {
  sendP2PMessageReliable: async (...args: unknown[]): Promise<void> => { clientCalls.push(args); },
};
vi.mock('../../websocket-service', () => ({ websocketService: { getClient: (): typeof client => client } }));

const { MessengerOperations } = await import('../messenger-operations');
const { handleSendP2PMessageProxy } = await import('../../multi-instance/leader-proxy-handlers');

const ops: InstanceType<typeof MessengerOperations> = new MessengerOperations({
  init: async (): Promise<void> => {},
  getClient: () => client as never,
});

const acks: Array<{ status: string; error?: string }> = [];
type SendAck = Parameters<typeof handleSendP2PMessageProxy>[1];
const sendAck: SendAck = (_to: string, _id: string, status: 'processed' | 'error', error?: string): void => {
  acks.push({ status, ...(error !== undefined ? { error } : {}) });
};

async function leaderHandles(payload: Record<string, unknown>): Promise<void> {
  await handleSendP2PMessageProxy({ requestId: 'r', senderInstanceId: 'follower', payload }, sendAck);
}

describe('a reliable send’s compression hint', () => {
  beforeEach((): void => { toLeader.length = 0; clientCalls.length = 0; acks.length = 0; });

  it('reaches the client from the leader tab', async () => {
    role.isLeader = true;
    await ops.sendP2PMessageReliable(1n, 2n, new Uint8Array([7]), 'High', 'yjs-update');
    expect(clientCalls).toEqual([['1', '2', new Uint8Array([7]), 'High', 'yjs-update']]);
  });

  it('reaches the leader’s client from a follower tab, with its level', async () => {
    role.isLeader = false;
    await ops.sendP2PMessageReliable(1n, 2n, new Uint8Array([7]), 'Extreme', 'json');
    expect(toLeader).toHaveLength(1);
    expect(toLeader[0]).toMatchObject({ securityLevel: 'Extreme', compressionHint: 'json' });
    await leaderHandles(toLeader[0]);
    expect(clientCalls).toEqual([['1', '2', new Uint8Array([7]), 'Extreme', 'json']]);
    expect(acks).toEqual([{ status: 'processed' }]);
  });

  it('is absent at the client when a follower gave none', async () => {
    role.isLeader = false;
    await ops.sendP2PMessageReliable(1n, 2n, new Uint8Array([7]));
    await leaderHandles(toLeader[0]);
    expect(clientCalls).toEqual([['1', '2', new Uint8Array([7]), undefined, undefined]]);
  });

  it('is refused at the leader when it is not one the WASM client knows', async () => {
    await leaderHandles({ localCid: '1', peerCid: '2', message: [7], compressionHint: 'zstd' });
    expect(clientCalls).toEqual([]);
    expect(acks).toEqual([{ status: 'error', error: 'Unknown compression hint zstd' }]);
  });
});
