/**
 * When the agent supervises an account, this window's auto-connect stands down:
 * no dial, no retry, no polling. An older agent, which does not say it
 * supervises, keeps today's behaviour exactly.
 *
 * Real: the capability read from the agent's greeting, connectToPeer,
 * connectToAllRegisteredPeers, startPolling, the service singleton's
 * ensurePeerConnectedInBackground, the auto-connect state, the pause rules.
 * Stood in, each because it is the WebSocket to the agent or a read over it:
 * the websocket service (dials are recorded, LocalDB reads answer "absent"),
 * the registration service (its peer lists are agent requests) and the
 * connection manager (GetSessions). The agent itself is FakeAgent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAgent } from './fake-supervising-agent';

const PEER: bigint = 200n;
const OURS: bigint = 100n;
const dialled: Array<[bigint, bigint]> = [];
let sessionReads: number = 0;
let dialsFail: boolean = false;

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (): Promise<never> => { throw new Error('Key not found: p2p_paused_peer'); },
    openP2PConnection: async (cid: bigint, target: bigint): Promise<void> => {
      dialled.push([cid, target]);
      if (dialsFail) throw new Error('PeerConnect timed out');
    },
  },
}));
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    listRegisteredPeers: async (): Promise<Array<{ cid: bigint }>> => [{ cid: 200n }],
    listAllPeers: async (): Promise<Array<{ cid: bigint; online_status: boolean }>> => [{ cid: 200n, online_status: true }],
    hasOutgoingRegistration: (): boolean => false,
  },
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: { getActiveSessions: async (): Promise<unknown[]> => { sessionReads += 1; return []; } },
}));

const { instanceManager } = await import('@/lib/multi-instance/instance-manager');
const { AutoConnectState } = await import('@/lib/p2p-auto-connect-service/state');
const { connectToPeer, connectToAllRegisteredPeers } = await import('@/lib/p2p-auto-connect-service/connection-logic');
const { startPolling, stopPolling, startBackendPolling } = await import('@/lib/p2p-auto-connect-service/polling');
const { p2pAutoConnectService } = await import('@/lib/p2p-auto-connect-service');
const { forgetCapabilities, registerCapabilityRoute } = await import('@/lib/agent-conversations/capabilities');

const agent: FakeAgent = new FakeAgent();

beforeEach((): void => {
  dialled.length = 0; agent.sent.length = 0; agent.silent = false; sessionReads = 0; dialsFail = false;
  vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
  instanceManager.setCid(OURS);
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
});
afterEach((): void => { vi.restoreAllMocks(); forgetCapabilities(); });

describe('dialling', () => {
  it('does not happen for a supervised account, and leaves no retry', async (): Promise<void> => {
    await agent.greet('supervising');
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    await connectToPeer(state, PEER);
    expect(dialled).toEqual([]);
    expect(state.hasConnectionAttempt(PEER)).toBe(false);
  });

  it('still happens when the agent does not say it supervises', async (): Promise<void> => {
    await agent.greet('older');
    await connectToPeer(new AutoConnectState(), PEER);
    expect(dialled).toEqual([[OURS, PEER]]);
  });

  it('is not started for every registered peer at start-up either, only the agent is asked what it holds', async (): Promise<void> => {
    await agent.greet('supervising');
    await connectToAllRegisteredPeers(new AutoConnectState());
    expect(dialled).toEqual([]);
    expect(sessionReads).toBe(1);
  });

  it('is started for every registered peer by an older agent', async (): Promise<void> => {
    await agent.greet('older');
    await connectToAllRegisteredPeers(new AutoConnectState());
    await vi.waitFor((): void => { expect(dialled).toEqual([[OURS, PEER]]); });
  });
});

describe('polling', () => {
  it('does not start for a supervised account, however it is asked', async (): Promise<void> => {
    await agent.greet('supervising');
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    startPolling(state, async (): Promise<void> => undefined);
    expect(state.pollingInterval).toBeNull();
  });

  it('keeps the GetSessions state poll running for a supervised account', async (): Promise<void> => {
    await agent.greet('supervising');
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    startBackendPolling(state);
    expect(state.backendPollInterval).not.toBeNull();
    if (state.backendPollInterval) clearInterval(state.backendPollInterval);
  });

  it('starts for an agent that does not supervise', async (): Promise<void> => {
    await agent.greet('older');
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    startPolling(state, async (): Promise<void> => undefined);
    startBackendPolling(state);
    expect(state.pollingInterval).not.toBeNull();
    expect(state.backendPollInterval).not.toBeNull();
    stopPolling(state);
    if (state.backendPollInterval) clearInterval(state.backendPollInterval);
  });
});

describe('a window that wants a peer connected', () => {
  it('sends Interest for a supervised account, dials nothing, and never waits on the agent', async (): Promise<void> => {
    await agent.greet('supervising');
    agent.silent = true;
    instanceManager.setCid(OURS);
    const before: number = Date.now();
    await p2pAutoConnectService.ensurePeerConnectedInBackground(PEER);
    expect(dialled).toEqual([]);
    await vi.waitFor((): void => { expect(agent.interests()).toHaveLength(1); });
    const [interest] = agent.interests();
    expect(interest.peerCid).toBe(PEER);
    expect(interest.sessionCid).toBe(OURS);
    expect(Number(interest.until)).toBeGreaterThan(before);
  });

  it('sends no Interest to an agent that does not supervise, and dials as before', async (): Promise<void> => {
    await agent.greet('older');
    await p2pAutoConnectService.ensurePeerConnectedInBackground(PEER);
    await vi.waitFor((): void => { expect(dialled).toEqual([[OURS, PEER]]); });
    expect(agent.interests()).toEqual([]);
  });
});

describe('an agent that says it supervises after polling has started', () => {
  it('stands the polls down', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      await agent.greet('older');
      p2pAutoConnectService.startPolling();
      p2pAutoConnectService.startBackendPolling();
      expect(vi.getTimerCount()).toBe(2);
      await agent.greet('supervising');
      await vi.dynamicImportSettled();
      expect(vi.getTimerCount()).toBe(1); // the dial poll is gone; the state poll stays
    } finally {
      vi.useRealTimers();
      p2pAutoConnectService.stopPolling();
      p2pAutoConnectService.stopBackendPolling();
    }
  });

  it('leaves them running when it turns out not to', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      await agent.greet('older');
      p2pAutoConnectService.startPolling();
      p2pAutoConnectService.startBackendPolling();
      await agent.greet('older');
      expect(vi.getTimerCount()).toBe(2);
    } finally {
      vi.useRealTimers();
      p2pAutoConnectService.stopPolling();
      p2pAutoConnectService.stopBackendPolling();
    }
  });

  it('cancels a retry already waiting to redial', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      await agent.greet('older');
      dialsFail = true;
      // Another peer than the tests above: the singleton remembers a dial still pending for those.
      await p2pAutoConnectService.connectToPeer(300n);
      expect(vi.getTimerCount()).toBe(1); // the retry
      await agent.greet('supervising');
      await vi.dynamicImportSettled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      p2pAutoConnectService.cancelAllRetries();
    }
  });
});
