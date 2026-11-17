/**
 * While a contact is paused, this browser neither dials it nor answers it.
 *
 * A bare PeerDisconnect is undone within seconds: every dial path funnels into
 * `connectToPeer` (startup, the periodic poll, the retry timer, a message
 * send's `ensurePeerConnectedInBackground`), and the peer's own auto-connect
 * dials us back, which `handleIncomingPeerConnect` accepts. So the pause is
 * enforced at both of those doors.
 *
 * Real: `connectToPeer`, `handleIncomingPeerConnect`, the auto-connect state,
 * the pause key scheme and rules. Stood in: the websocket service, because it
 * is the WebSocket to the agent -- its LocalDB reads are backed by a Map with
 * the agent's absent-key rejection, and its connect/accept/decline requests
 * are recorded rather than sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pauseKey, PAUSED_MARKER } from '@/lib/p2p-pause/pause-rules';
import { stringToBytes } from '@/lib/utils/encoding-utils';

const ALICE: bigint = 100n;
const BOB: bigint = 200n;
const CAROL: bigint = 300n;

const rows: Map<string, number[]> = new Map();
let readsFail: boolean = false;
const dialled: Array<[bigint, bigint]> = [];
const answered: Array<{ peer: bigint; accept: boolean }> = [];

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (cid: bigint, key: string): Promise<{ value: number[] } | null> => {
      if (readsFail) throw new Error('LocalDB request timed out after 5000ms');
      const value: number[] | undefined = rows.get(`${cid.toString()}/${key}`);
      if (value === undefined) throw new Error(`Key not found: ${key}`);
      return { value };
    },
    openP2PConnection: async (cid: bigint, target: bigint): Promise<void> => { dialled.push([cid, target]); },
    acceptPeerConnect: async (_cid: bigint, peer: bigint): Promise<void> => { answered.push({ peer, accept: true }); },
    declinePeerConnect: async (_cid: bigint, peer: bigint): Promise<void> => { answered.push({ peer, accept: false }); },
  },
}));

const { instanceManager } = await import('@/lib/multi-instance/instance-manager');
const { AutoConnectState } = await import('../state');
const { connectToPeer } = await import('../connection-logic');
const { handleIncomingPeerConnect } = await import('../incoming-connect');

function pausedBy(local: bigint, peer: bigint): void {
  rows.set(`${local.toString()}/${pauseKey(peer)}`, stringToBytes(PAUSED_MARKER));
}

describe('dialling a paused contact', () => {
  beforeEach((): void => {
    rows.clear(); dialled.length = 0; answered.length = 0; readsFail = false;
    vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
    instanceManager.setCid(ALICE);
  });

  it('does not happen', async (): Promise<void> => {
    pausedBy(ALICE, BOB);
    await connectToPeer(new AutoConnectState(), BOB);
    expect(dialled).toEqual([]);
  });

  it('still happens for a contact that is not paused', async (): Promise<void> => {
    // The discrimination: a gate that refused everything passes the case above.
    pausedBy(ALICE, BOB);
    await connectToPeer(new AutoConnectState(), CAROL);
    expect(dialled).toEqual([[ALICE, CAROL]]);
  });

  it('does not happen when the pause record could not be read', async (): Promise<void> => {
    readsFail = true;
    await connectToPeer(new AutoConnectState(), BOB);
    expect(dialled).toEqual([]);
  });

  it('leaves no retry behind to redial later', async (): Promise<void> => {
    pausedBy(ALICE, BOB);
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    await connectToPeer(state, BOB);
    expect(state.hasConnectionAttempt(BOB)).toBe(false);
    expect(state.hasPendingConnection(BOB)).toBe(false);
  });
});

describe('a paused contact dialling us', () => {
  beforeEach((): void => {
    rows.clear(); dialled.length = 0; answered.length = 0; readsFail = false;
    instanceManager.setCid(ALICE);
  });

  const noop: (l: bigint, p: bigint) => void = (): void => {};

  it('is declined, and not marked connected', async (): Promise<void> => {
    pausedBy(ALICE, BOB);
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    await handleIncomingPeerConnect(state, { cid: ALICE, peer_cid: BOB }, (l, p): void => state.setPeerConnectedLocal(l, p));
    expect(answered).toEqual([{ peer: BOB, accept: false }]);
    expect(state.isPeerConnectedForSession(ALICE, BOB)).toBe(false);
  });

  it('is accepted when not paused', async (): Promise<void> => {
    await handleIncomingPeerConnect(new AutoConnectState(), { cid: ALICE, peer_cid: CAROL }, noop);
    expect(answered).toEqual([{ peer: CAROL, accept: true }]);
  });

  it('gets no answer at all when the pause record could not be read', async (): Promise<void> => {
    readsFail = true;
    await handleIncomingPeerConnect(new AutoConnectState(), { cid: ALICE, peer_cid: BOB }, noop);
    expect(answered).toEqual([]);
  });
});

describe('the leader, hearing a paused contact dial a session in this browser', () => {
  it('does not mark that link connected on the notification alone', async (): Promise<void> => {
    rows.clear(); readsFail = false;
    vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
    instanceManager.setCid(ALICE);
    const { broadcastChannelService } = await import('@/lib/broadcast-channel-service');
    vi.spyOn(broadcastChannelService, 'broadcastStateSync').mockImplementation((): void => {});
    const { p2pAutoConnectService } = await import('../index');
    const { eventEmitter } = await import('@/lib/event-emitter');

    const FOLLOWER_SESSION: bigint = 400n;
    const DAVE: bigint = 500n;
    pausedBy(FOLLOWER_SESSION, BOB);

    eventEmitter.emit('websocket-message', { PeerConnectNotification: { cid: FOLLOWER_SESSION, peer_cid: BOB } });
    eventEmitter.emit('websocket-message', { PeerConnectNotification: { cid: FOLLOWER_SESSION, peer_cid: DAVE } });

    // The unpaused one is the clock: once it has landed, the paused one has
    // had the same chance to.
    await vi.waitFor((): void => {
      expect(p2pAutoConnectService.isPeerConnectedForSession(FOLLOWER_SESSION, DAVE)).toBe(true);
    });
    expect(p2pAutoConnectService.isPeerConnectedForSession(FOLLOWER_SESSION, BOB)).toBe(false);
    vi.restoreAllMocks();
  });
});
