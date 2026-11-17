/**
 * A link to a paused contact that comes up anyway is not admitted, and is dropped.
 *
 * Seen live: lara paused max, declined his redials -- and ~18 s later he was
 * "Online" and messages flowed both ways. The SDK had auto-accepted one of his
 * redials at protocol level (a declined PostConnect left an outgoing-attempt
 * entry that its simultaneous-connect rule read as consent; fixed in the SDK
 * separately), and the agent then told lara's page `PeerConnectSuccess`. This
 * app believed it, marked max connected, and the ILM -- whose idea of
 * "connected" is this app's -- drained the held queue.
 *
 * Two doors let a link in: `PeerConnectSuccess`, and the GetSessions poll that
 * merges whatever the agent lists. Neither admits a paused pair, and the
 * leader drops such a link rather than leaving it up unused.
 *
 * Real: the service's websocket-message handler, the poll merge, the pause
 * rules. Stood in: the websocket service and the connection manager, which are
 * the WebSocket to the agent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pauseKey, PAUSED_MARKER } from '@/lib/p2p-pause/pause-rules';
import { stringToBytes } from '@/lib/utils/encoding-utils';

const LARA: bigint = 9399548604789644783n;
const MAX: bigint = 15630987608599047565n;
const CAROL: bigint = 300n;

const rows: Map<string, number[]> = new Map();
const dropped: Array<[bigint, bigint]> = [];
let agentLists: bigint[] = [];

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (cid: bigint, key: string): Promise<{ value: number[] } | null> => {
      const value: number[] | undefined = rows.get(`${cid.toString()}/${key}`);
      if (value === undefined) throw new Error(`Key not found: ${key}`);
      return { value };
    },
    disconnectP2P: async (cid: bigint, peer: bigint): Promise<void> => { dropped.push([cid, peer]); },
  },
}));

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getActiveSessions: async (): Promise<unknown[]> => [{
      cid: LARA, username: 'lara', server_address: 'lab',
      peer_connections: new Map(agentLists.map((p: bigint) => [p.toString(), { peer_username: 'x' }])),
    }],
  },
}));

const { instanceManager } = await import('@/lib/multi-instance/instance-manager');
const { broadcastChannelService } = await import('@/lib/broadcast-channel-service');
const { p2pAutoConnectService } = await import('../index');
const { eventEmitter } = await import('@/lib/event-emitter');
const { AutoConnectState } = await import('../state');
const { refreshFromBackend } = await import('../polling');

function paused(local: bigint, peer: bigint): void {
  rows.set(`${local.toString()}/${pauseKey(peer)}`, stringToBytes(PAUSED_MARKER));
}

describe('a link to a paused contact', () => {
  beforeEach((): void => {
    rows.clear(); dropped.length = 0; agentLists = [];
    vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
    vi.spyOn(broadcastChannelService, 'broadcastStateSync').mockImplementation((): void => {});
    instanceManager.setCid(LARA);
    p2pAutoConnectService.setPeerDisconnected(LARA, MAX);
    p2pAutoConnectService.setPeerDisconnected(LARA, CAROL);
  });

  it('reported up by PeerConnectSuccess is not admitted, and is dropped', async (): Promise<void> => {
    paused(LARA, MAX);
    eventEmitter.emit('websocket-message', { PeerConnectSuccess: { cid: LARA, peer_cid: MAX } });
    eventEmitter.emit('websocket-message', { PeerConnectSuccess: { cid: LARA, peer_cid: CAROL } });
    // CAROL is the clock: once her link is admitted, MAX's had the same chance.
    await vi.waitFor((): void => {
      expect(p2pAutoConnectService.isPeerConnectedForSession(LARA, CAROL)).toBe(true);
    });
    await vi.waitFor((): void => { expect(dropped).toEqual([[LARA, MAX]]); });
    expect(p2pAutoConnectService.isPeerConnectedForSession(LARA, MAX)).toBe(false);
  });

  it('listed by the agent is not merged in by the poll', async (): Promise<void> => {
    paused(LARA, MAX);
    agentLists = [MAX, CAROL];
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    await refreshFromBackend(state, LARA);
    expect(state.isPeerConnectedForSession(LARA, CAROL), 'the positive control').toBe(true);
    expect(state.isPeerConnectedForSession(LARA, MAX)).toBe(false);
  });
});
