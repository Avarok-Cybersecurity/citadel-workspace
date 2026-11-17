/**
 * An incoming connection offered below this chat's encryption level is
 * declined; one at or above it is accepted.
 *
 * Every offer used to be accepted. The P2P channel is keyed at the level the
 * OPENER asked for (the agent ignores the acceptor's settings), so accepting a
 * Standard offer put a chat set to High on a one-layer ratchet. Declining it
 * leaves the channel to be opened by this side, at this chat's level.
 *
 * Stood in: the agent socket (`websocketService`). The auto-connect state,
 * the settings store (over jsdom's localStorage) and the level rule are
 * production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OURS: bigint = 9001n;
const PEER: bigint = 9002n;

const answers: Array<{ accept: boolean; cid: bigint; peer: bigint }> = [];
vi.mock('../../websocket-service', () => ({
  websocketService: {
    acceptPeerConnect: async (cid: bigint, peer: bigint): Promise<void> => { answers.push({ accept: true, cid, peer }); },
    declinePeerConnect: async (cid: bigint, peer: bigint): Promise<void> => { answers.push({ accept: false, cid, peer }); },
    // The pause record, as the agent answers for a contact nobody paused (see p2p-pause/agent-storage).
    sendLocalDBGet: async (): Promise<never> => { throw new Error('Key not found'); },
  },
}));

const { handleIncomingPeerConnect } = await import('../incoming-connect');
const { AutoConnectState } = await import('../state');
const { chatAdvancedSettings } = await import('@/lib/p2p/chat-advanced-settings');
const { instanceManager } = await import('@/lib/multi-instance/instance-manager');

function offer(level: unknown): { cid: bigint; peer_cid: bigint; session_security_settings: { security_level: unknown } } {
  return { cid: OURS, peer_cid: PEER, session_security_settings: { security_level: level } };
}

describe('an incoming connection and the chat level', () => {
  beforeEach((): void => {
    answers.length = 0;
    localStorage.clear();
    instanceManager.setCid(OURS);
  });

  it('is declined when offered below the level, and not marked connected', async () => {
    await chatAdvancedSettings.set(OURS, PEER, { securityLevel: 'High' });
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    const broadcast: Array<[bigint, bigint]> = [];

    await handleIncomingPeerConnect(state, offer('Standard'), (a: bigint, b: bigint): void => { broadcast.push([a, b]); });

    expect(answers).toEqual([{ accept: false, cid: OURS, peer: PEER }]);
    expect(broadcast).toEqual([]);
    expect(state.isPeerConnectedForSession(OURS, PEER)).toBe(false);
  });

  it('keeps this side\'s own attempt alive when it declines', async () => {
    // The decline only works because this side then opens the channel itself.
    await chatAdvancedSettings.set(OURS, PEER, { securityLevel: 'High' });
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    state.addPendingConnection(PEER);

    await handleIncomingPeerConnect(state, offer('Reinforced'), (): void => {});

    expect(state.hasPendingConnection(PEER)).toBe(true);
  });

  it.each(['High', 'Extreme'])('is accepted when offered at %s', async (level: string) => {
    await chatAdvancedSettings.set(OURS, PEER, { securityLevel: 'High' });
    await handleIncomingPeerConnect(new AutoConnectState(), offer(level), (): void => {});
    expect(answers).toEqual([{ accept: true, cid: OURS, peer: PEER }]);
  });

  it('is accepted at any level for a chat that chose nothing', async () => {
    await handleIncomingPeerConnect(new AutoConnectState(), offer('Standard'), (): void => {});
    expect(answers).toEqual([{ accept: true, cid: OURS, peer: PEER }]);
  });
});
