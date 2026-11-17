/**
 * The leader tab marks the target of a PeerConnectNotification connected the
 * moment it arrives -- so the follower tab that owns the target session sees
 * the link at once. With a chat level in force, the target session DECLINES an
 * offer below it; marking that offer connected would show a link that never
 * comes up. So the leader applies the same rule before it marks anything.
 *
 * Stood in: the agent socket. The event wiring, the settings store (over
 * jsdom's localStorage) and the level rule are production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const LEADER_SESSION: bigint = 7001n;
const FOLLOWER_SESSION: bigint = 7002n;
const PEER: bigint = 7003n;

vi.mock('../../websocket-service', () => ({
  websocketService: {
    acceptPeerConnect: async (): Promise<void> => {},
    declinePeerConnect: async (): Promise<void> => {},
    // The pause record, as the agent answers for a contact nobody paused (see p2p-pause/agent-storage).
    sendLocalDBGet: async (): Promise<never> => { throw new Error('Key not found'); },
  },
}));

// Through the service, as the app loads it: event-handlers alone is mid-cycle.
await import('..');
const { setupEventListeners } = await import('../event-handlers');
const { AutoConnectState } = await import('../state');
const { eventEmitter } = await import('@/lib/event-emitter');
const { instanceManager } = await import('@/lib/multi-instance/instance-manager');
const { chatAdvancedSettings } = await import('@/lib/p2p/chat-advanced-settings');

const marked: Array<[bigint, bigint]> = [];
setupEventListeners(new AutoConnectState(), (a: bigint, b: bigint): void => { marked.push([a, b]); }, async (): Promise<void> => {});

async function notify(level: string): Promise<void> {
  eventEmitter.emit('websocket-message', {
    PeerConnectNotification: { cid: FOLLOWER_SESSION, peer_cid: PEER, session_security_settings: { security_level: level }, udp_mode: 'Enabled' },
  });
  // The level is read asynchronously; let it settle.
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
}

describe('the leader, on an offer for a follower session', () => {
  beforeEach(async (): Promise<void> => {
    marked.length = 0;
    localStorage.clear();
    instanceManager.setCid(LEADER_SESSION);
    instanceManager.setLeader(true, 'leader-tab');
    await chatAdvancedSettings.set(FOLLOWER_SESSION, PEER, { securityLevel: 'High' });
  });

  it('does not mark an offer below that chat\'s level connected', async () => {
    await notify('Standard');
    expect(marked).toEqual([]);
  });

  it('marks an offer at the level connected', async () => {
    await notify('High');
    expect(marked).toEqual([[FOLLOWER_SESSION, PEER]]);
  });
});
