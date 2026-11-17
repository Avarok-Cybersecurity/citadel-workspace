/**
 * Measured live: a member who was P2P-registered, online and connected was
 * shown "not delivered — not connected with you over P2P", and no offer was
 * ever sent. The check read the registration service's in-memory map, which
 * `ListRegisteredPeers` (what the sidebar and direct chat render from) never
 * fills. Presence was "not known yet" at the time too.
 *
 * The first half tests the lookup; the second runs the production wiring
 * (`sendGroupFile`) with the network singletons it calls replaced -- the
 * registration service, the transfer service, the group wire and the session
 * -- because the bug lived in which source that wiring asked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupConversation } from '@/types/group';
import type { MemberDelivery } from '@/types/group-file-share';
import { registrationLookup, type RegistrationLookup } from '../group-file-registration';
import { sendGroupFile } from '../send-group-file';

const world: { cached: bigint[]; listed: bigint[] | Error; sent: string[] } = vi.hoisted(() => ({
  cached: [] as bigint[], listed: [] as bigint[] | Error, sent: [] as string[],
}));

vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    getPeers: (): { registeredPeers: Array<{ cid: bigint }> } => ({ registeredPeers: world.cached.map((cid: bigint) => ({ cid })) }),
    isPeerRegistered: (cid: bigint): boolean => world.cached.includes(cid),
    listRegisteredPeersWithRetry: async (): Promise<Array<{ cid: bigint }>> => {
      if (world.listed instanceof Error) throw world.listed;
      return world.listed.map((cid: bigint) => ({ cid }));
    },
  },
}));
vi.mock('@/lib/file-transfer', () => ({
  fileTransferService: { sendFile: async (cid: string): Promise<string> => { world.sent.push(cid); return `t-${cid}`; } },
}));
vi.mock('../group-requests', () => ({ sendPeerGroupBody: async (): Promise<string> => 'f-1' }));
vi.mock('../group-store', () => ({
  getGroups: (): GroupConversation[] => [{
    id: '1:5', name: 'g', ownerId: 1n, unreadCount: 0, settings: { defaultRoleId: 'member', roles: [] },
    members: [
      { cid: 1n, username: 'alice', roleId: 'owner', joinedAt: 0 },
      { cid: 2n, username: 'bob', roleId: 'member', joinedAt: 0 },
      { cid: 3n, username: 'cy', roleId: 'member', joinedAt: 0 },
    ],
  }],
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 1n }) };
});

beforeEach((): void => { world.cached = []; world.listed = []; world.sent = []; });

describe('who is registered with the sender', () => {
  it('believes the agent\'s listing over an empty cache', async () => {
    const lookup: RegistrationLookup = await registrationLookup([], async () => [{ cid: 2n }]);
    expect(lookup(2n)).toBe(true);
    expect(lookup(3n)).toBe(false);
  });

  it('keeps a cached registration the listing has not caught up with', async () => {
    const lookup: RegistrationLookup = await registrationLookup([3n], async () => [{ cid: 2n }]);
    expect(lookup(3n)).toBe(true);
  });

  it('says it does not know, rather than no, when the agent cannot be asked', async () => {
    const lookup: RegistrationLookup = await registrationLookup([3n], async () => { throw new Error('timed out'); });
    expect(lookup(2n)).toBeNull();
    expect(lookup(3n)).toBe(true);
  });
});

describe('sharing into a group, as wired', () => {
  it('offers the file to a member the agent lists as registered, with nothing in the cache', async () => {
    world.listed = [2n];
    const result: { deliveries: MemberDelivery[] } = await sendGroupFile('1:5', new File(['x'], 'x.txt'));
    expect(world.sent).toEqual(['2']);
    expect(result.deliveries.map((d: MemberDelivery): string => `${d.username}:${d.kind}`)).toEqual(['bob:offered', 'cy:skipped']);
  });

  it('attempts everyone when the listing fails, and reports each outcome', async () => {
    world.listed = new Error('timed out');
    await sendGroupFile('1:5', new File(['x'], 'x.txt'));
    expect(world.sent).toEqual(['2', '3']);
  });
});
