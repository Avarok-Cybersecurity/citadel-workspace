/**
 * An offer the agent answers itself is not answered again by a window.
 *
 * The agent answers connects for an account it hosts, so the account is
 * reachable with no window showing it (agent kernel/inbound_connect). It says
 * so on the notification (`answered_by_agent`). A window that answered as well
 * would send a second accept or decline for one offer. It still keeps its own
 * connection state as before. An agent that predates the field never sets it,
 * and the window answers as it always has.
 *
 * Stood in: the agent socket (`websocketService`). The auto-connect state, the
 * pause rules, the settings store (over jsdom's localStorage) and the level
 * rule are production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OURS: bigint = 9101n;
const PEER: bigint = 9102n;

const answers: Array<{ accept: boolean; cid: bigint; peer: bigint }> = [];
let pauseRecord: { value: number[] } | null = null;
vi.mock('../../websocket-service', () => ({
  websocketService: {
    acceptPeerConnect: async (cid: bigint, peer: bigint): Promise<void> => { answers.push({ accept: true, cid, peer }); },
    declinePeerConnect: async (cid: bigint, peer: bigint): Promise<void> => { answers.push({ accept: false, cid, peer }); },
    // The agent's LocalDB: no pause record unless a test sets one.
    sendLocalDBGet: async (): Promise<{ value: number[] }> => {
      if (pauseRecord === null) throw new Error('Key not found');
      return pauseRecord;
    },
  },
}));

const { handleIncomingPeerConnect } = await import('../incoming-connect');
const { AutoConnectState } = await import('../state');
const { chatAdvancedSettings } = await import('@/lib/p2p/chat-advanced-settings');
const { instanceManager } = await import('@/lib/multi-instance/instance-manager');

type Offer = { cid: bigint; peer_cid: bigint; session_security_settings: { security_level: unknown }; answered_by_agent?: boolean };

function offer(answeredByAgent: boolean | undefined, level: unknown = 'Standard'): Offer {
  const base: Offer = { cid: OURS, peer_cid: PEER, session_security_settings: { security_level: level } };
  return answeredByAgent === undefined ? base : { ...base, answered_by_agent: answeredByAgent };
}

describe('an offer the agent answers', () => {
  beforeEach((): void => {
    answers.length = 0;
    pauseRecord = null;
    localStorage.clear();
    instanceManager.setCid(OURS);
  });

  it('is not accepted again, and the window still records the connection', async () => {
    const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
    const broadcast: Array<[bigint, bigint]> = [];
    await handleIncomingPeerConnect(state, offer(true), (a: bigint, b: bigint): void => { broadcast.push([a, b]); });
    expect(answers).toEqual([]);
    expect(broadcast).toEqual([[OURS, PEER]]);
  });

  it('is not declined again for a paused contact', async () => {
    pauseRecord = { value: Array.from(new TextEncoder().encode('paused')) };
    await handleIncomingPeerConnect(new AutoConnectState(), offer(true), (): void => {});
    expect(answers).toEqual([]);
  });

  it('is not declined again below the chat level', async () => {
    await chatAdvancedSettings.set(OURS, PEER, { securityLevel: 'High' });
    await handleIncomingPeerConnect(new AutoConnectState(), offer(true, 'Standard'), (): void => {});
    expect(answers).toEqual([]);
  });

  it.each([false, undefined])('is answered by the window when the agent says %s', async (flag: boolean | undefined) => {
    await handleIncomingPeerConnect(new AutoConnectState(), offer(flag), (): void => {});
    expect(answers).toEqual([{ accept: true, cid: OURS, peer: PEER }]);
  });
});
