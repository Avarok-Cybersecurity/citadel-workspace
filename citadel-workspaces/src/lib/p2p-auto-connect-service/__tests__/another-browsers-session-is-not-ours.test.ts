/**
 * A session another browser signed in to is not ours to act for.
 *
 * Seen on the live bench, alice and bob signed in on the same agent from two
 * browsers: alice's page kept sending PeerConnect for BOB's session, and the
 * agent kept refusing it -- "Refusing PeerConnect for session <bob> from
 * connection <alice's>: the connection does not own it" -- with "Session
 * unavailable to this connection" in the console on every retry.
 *
 * `connectToPeer` reverses the initiator when both sessions belong to this
 * browser (one WebSocket, two tabs), which is legitimate. Whether they do was
 * answered by `GetSessions` -- and GetSessions lists every session the AGENT
 * holds, whichever connection holds it. On a shared agent, every peer looked
 * like ours.
 *
 * This browser's sessions are the ones its tabs hold: this tab's cid and the
 * cids the other tabs have registered over the BroadcastChannel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ALICE: bigint = 100n;
const BOB: bigint = 200n;

// The agent's view, which lists sessions regardless of which connection owns
// them. Mocked because it is a WebSocket round trip; the point of the test is
// that ownership must not be read off it.
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getActiveSessions: async (): Promise<unknown[]> => [
      { cid: ALICE, username: 'alice', server_address: 'bench', peer_connections: {} },
      { cid: BOB, username: 'bob', server_address: 'bench', peer_connections: {} },
    ],
  },
}));

const { instanceManager } = await import('@/lib/multi-instance/instance-manager');
const { ownsSession } = await import('../session-ownership');

describe('which sessions this browser owns', () => {
  beforeEach((): void => {
    instanceManager.setCid(ALICE);
    for (const info of instanceManager.getAllInstances()) instanceManager.unregisterInstance(info.instanceId);
  });

  it("does not claim a session only the agent lists -- another browser's", () => {
    expect(ownsSession(BOB)).toBe(false);
  });

  it("claims a session one of this browser's tabs holds", () => {
    // Positive control: multi-tab P2P reverses the initiator on purpose.
    instanceManager.registerInstance('tab-2', BOB);
    expect(ownsSession(BOB)).toBe(true);
  });

  it('claims its own session', () => {
    expect(ownsSession(ALICE)).toBe(true);
  });
});
