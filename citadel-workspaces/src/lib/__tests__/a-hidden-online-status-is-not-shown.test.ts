/**
 * "Online Status: off" is honoured by the people looking, because it has to be.
 *
 * Presence comes from the Citadel server's peer list (`ListAllPeers`), which
 * reports every member's connection to every other member and knows nothing of
 * the setting. So each viewer's client reads the choice the member published on
 * their record and shows them as not known -- not online, and not offline,
 * which would be a claim too -- unless this session holds a live P2P
 * connection with them, which cannot be hidden.
 *
 * Doubles: the peer registry and the auto-connect service, which hold what the
 * agent last reported (the poll and the live connection map). The published
 * choice travels through the real response handler and mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { peers, connected } = vi.hoisted(() => ({
  peers: { current: [] as Array<{ cid: bigint; username: string; fullName: string; isOnline: boolean | null; isRegistered: boolean }> },
  connected: { current: new Set<string>() },
}));

vi.mock('../p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    peerOnlineStatus: (): boolean | null => true,
    isPeerConnectedForSession: (session: bigint, peer: bigint): boolean => connected.current.has(`${session}:${peer}`),
  },
}));
vi.mock('../p2p-registration-service', () => ({
  p2pRegistrationService: { getPeers: (): unknown => ({ allPeers: peers.current, registeredPeers: [] }) },
}));

const { presenceAsShown, shownPresence, isMemberOnline } = await import('../presence');
const { handleGeneratedVariants } = await import('../workspace-response-handler/generated-variant-handlers');
const { instanceManager } = await import('../multi-instance');
const { recordPeerUsernames } = await import('../member-names');
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { ConnectionInfo } from '../workspace-response-handler/workspace-handlers';

const never = (): boolean => false;
const always = (): boolean => true;

describe('the rule', () => {
  it('hides the presence of a member who turned it off, whatever it is', () => {
    expect(presenceAsShown(true, false, never)).toBeNull();
    expect(presenceAsShown(false, false, never)).toBeNull();
  });

  it('shows it to someone they are connected to directly', () => {
    expect(presenceAsShown(true, false, always)).toBe(true);
  });

  it('shows it when the member left it on or never chose', () => {
    expect(presenceAsShown(true, true, never)).toBe(true);
    expect(presenceAsShown(false, undefined, never)).toBe(false);
    expect(presenceAsShown(null, undefined, never)).toBeNull();
  });
});

function listMembers(members: Array<{ id: string; shows?: boolean }>): void {
  const response: unknown = {
    Members: {
      domain_id: null,
      members: members.map(({ id, shows }) => ({
        id, name: id, role: 'Member', permissions: {},
        metadata: shows === undefined ? {} : { shows_online_status: { type: 'Boolean', content: shows } },
      })),
    },
  };
  handleGeneratedVariants(response as WorkspaceProtocolResponse, { request_id: 'r' } as unknown as ConnectionInfo);
}

describe('a member as the workspace reports them', () => {
  beforeEach((): void => {
    peers.current = [{ cid: 42n, username: 'max', fullName: 'Max', isOnline: true, isRegistered: false }];
    connected.current = new Set<string>();
    instanceManager.setCid(1n);
  });

  it('is not known once they publish Online Status off', () => {
    listMembers([{ id: 'max', shows: false }]);
    expect(isMemberOnline('max')).toBeNull();
    expect(shownPresence('max', 42n, true)).toBeNull();
    // Known only by CID, as the chat knows them, once a peer list has named them.
    recordPeerUsernames([{ cid: 42n, username: 'max' }]);
    expect(shownPresence(undefined, 42n, true)).toBeNull();
  });

  it('is online again once they turn it back on', () => {
    listMembers([{ id: 'max', shows: false }]);
    listMembers([{ id: 'max', shows: true }]);
    expect(isMemberOnline('max')).toBe(true);
  });

  it('is online to a session with a live connection to them, and only that session', () => {
    listMembers([{ id: 'max', shows: false }]);
    connected.current = new Set<string>(['1:42']);
    expect(isMemberOnline('max')).toBe(true);
    instanceManager.setCid(2n);
    expect(isMemberOnline('max')).toBeNull();
  });
});
