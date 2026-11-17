/**
 * A peer this window has just registered with is connected at once, as it was
 * before supervision: under a supervising agent that means telling the agent
 * the peer is wanted. Registration, an accept and a resume all ask through
 * `connectToPeer`, and a supervised `connectToPeer` used to return having done
 * nothing at all: no dial (right) and no Interest (wrong). The agent dials only
 * a peer with Interest, a backlog or a recent drop, and a peer registered a
 * moment ago has none, so it stayed unconnected until a chat was opened.
 *
 * Real: the registration event handler, connectToPeer, the capability read from
 * the agent's greeting, the Interest request, the pause rules. Stood in, each
 * because it is the WebSocket to the agent: the websocket service (dials
 * recorded; LocalDB reads answer from a Map), the registration service (its
 * lists are agent requests). The agent itself is FakeAgent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAgent } from './fake-supervising-agent';
import { pauseKey, PAUSED_MARKER } from '@/lib/p2p-pause/pause-rules';
import { stringToBytes } from '@/lib/utils/encoding-utils';

const OURS: bigint = 100n;
const PEER: bigint = 200n;
const CAROL: bigint = 300n;
const dialled: Array<[bigint, bigint]> = [];
const rows: Map<string, number[]> = new Map();

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (cid: bigint, key: string): Promise<{ value: number[] }> => {
      const value: number[] | undefined = rows.get(`${cid.toString()}/${key}`);
      if (value === undefined) throw new Error(`Key not found: ${key}`);
      return { value };
    },
    openP2PConnection: async (cid: bigint, target: bigint): Promise<void> => { dialled.push([cid, target]); },
  },
}));
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    listRegisteredPeers: async (): Promise<Array<{ cid: bigint }>> => [],
    listAllPeers: async (): Promise<Array<{ cid: bigint; online_status: boolean }>> => [],
    hasOutgoingRegistration: (): boolean => false,
  },
}));

const { instanceManager } = await import('@/lib/multi-instance/instance-manager');
const { eventEmitter } = await import('@/lib/event-emitter');
await import('@/lib/p2p-auto-connect-service');
const { forgetCapabilities, registerCapabilityRoute } = await import('@/lib/agent-conversations/capabilities');

const agent: FakeAgent = new FakeAgent();

function registered(peerCid: bigint): void {
  eventEmitter.emit('p2p:peer-registered', { peer: { cid: peerCid }, isIncoming: false, isOutgoing: true });
}

beforeEach((): void => {
  dialled.length = 0; agent.sent.length = 0; agent.silent = false; rows.clear();
  vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
  instanceManager.setCid(OURS);
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
});
afterEach((): void => { vi.restoreAllMocks(); forgetCapabilities(); });

describe('a peer registered a moment ago', () => {
  it('is asked of a supervising agent, and not dialled by the window', async (): Promise<void> => {
    await agent.greet('supervising');
    agent.silent = true; // nothing waits on the agent's answer
    const before: number = Date.now();
    registered(PEER);
    await vi.waitFor((): void => { expect(agent.interests()).toHaveLength(1); });
    const [interest] = agent.interests();
    expect(interest.sessionCid).toBe(OURS);
    expect(interest.peerCid).toBe(PEER);
    expect(Number(interest.until)).toBeGreaterThan(before);
    expect(dialled).toEqual([]);
  });

  it('is not asked for while it is paused', async (): Promise<void> => {
    // The discrimination for the case above: a pause holds under supervision too.
    rows.set(`${OURS.toString()}/${pauseKey(PEER)}`, stringToBytes(PAUSED_MARKER));
    await agent.greet('supervising');
    registered(PEER);
    registered(CAROL);
    // The unpaused one is the clock: once it has been asked for, the paused one has had the same chance.
    await vi.waitFor((): void => { expect(agent.interests().map((i) => i.peerCid)).toEqual([CAROL]); });
    expect(dialled).toEqual([]);
  });

  it('is dialled by the window when the agent does not supervise, with nothing sent to it', async (): Promise<void> => {
    await agent.greet('older');
    const DAVE: bigint = 400n; // another peer: the singleton remembers a dial still pending for the others
    registered(DAVE);
    await vi.waitFor((): void => { expect(dialled).toEqual([[OURS, DAVE]]); });
    expect(agent.interests()).toEqual([]);
  });
});
