/**
 * Presence, and the four ways this dot has been wrong.
 *
 *   1. Math.random() — a coin flip.
 *   2. A demo-only map — constant false, while naming a real-sounding service.
 *   3. This module's first version — it parsed the member id as a CID. Member
 *      ids are USERNAMES (the kernel sets user_id from get_username_by_cid),
 *      so the numeric guard rejected every real id and it went straight back to
 *      constant false. The file's own comment asserted the wrong thing.
 *   4. UserDirectory answering "is this person registered with me" under a
 *      green dot, so a registered-but-offline peer showed as online.
 *   5. The data underneath: `Peer.isOnline` was a plain boolean and the
 *      registry INVENTED `true` for a peer the agent had said nothing about,
 *      while the poll's own set read empty-before-first-refresh as "everyone
 *      offline". Presence now has three answers, and null is one of them.
 *
 * The fixture below is a USERNAME, deliberately: version 3 passed every test it
 * had, because every test used a numeric id.
 */

import { describe, it, expect, vi, beforeEach  } from 'vitest';

const peerOnlineStatus = vi.fn<(cid: bigint) => boolean | null>();
const getPeers: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('../p2p-auto-connect-service', () => ({
  p2pAutoConnectService: { peerOnlineStatus: (cid: bigint): boolean | null => peerOnlineStatus(cid) },
}));
vi.mock('../p2p-registration-service', () => ({
  p2pRegistrationService: { getPeers: (): unknown => getPeers() },
}));

const { isMemberOnline, memberIdToCid } = await import('../presence');

const peer: (username: string, cid: bigint, isOnline?: boolean | null) => { cid: bigint; username: string; fullName: string; isOnline: boolean | null; isRegistered: boolean; } = (username: string, cid: bigint, isOnline: boolean | null = null): { cid: bigint; username: string; fullName: string; isOnline: boolean | null; isRegistered: boolean; } => ({
  cid,
  username,
  fullName: '',
  isOnline,
  isRegistered: true,
});

describe('member presence', () => {
  beforeEach(() => {
    peerOnlineStatus.mockReset().mockReturnValue(false);
    getPeers.mockReset().mockReturnValue({ allPeers: [], registeredPeers: [] });
  });

  it('finds a member by username, which is what a member id is', () => {
    getPeers.mockReturnValue({ allPeers: [peer('alice', 42n)], registeredPeers: [] });
    peerOnlineStatus.mockImplementation((cid) => cid === 42n);

    expect(isMemberOnline('alice')).toBe(true);
    expect(peerOnlineStatus).toHaveBeenCalledWith(42n);
  });

  it('does not answer the same for everyone', () => {
    // A presence function that cannot differ between two members is not
    // presence — which is exactly what versions 2 and 3 were.
    getPeers.mockReturnValue({
      allPeers: [peer('alice', 1n), peer('bob', 2n)],
      registeredPeers: [],
    });
    peerOnlineStatus.mockImplementation((cid) => cid === 1n);

    expect(isMemberOnline('alice')).toBe(true);
    expect(isMemberOnline('bob')).toBe(false);
  });

  it('falls back to the registry snapshot only before the first poll', () => {
    getPeers.mockReturnValue({ allPeers: [peer('alice', 42n, true)], registeredPeers: [] });
    peerOnlineStatus.mockReturnValue(null);

    expect(isMemberOnline('alice')).toBe(true);
  });

  it('lets a landed poll overrule a stale registry snapshot', () => {
    // The old version ORed the two, so a snapshot saying `true` outranked a
    // fresh poll saying otherwise. They come from the same backend call, so the
    // only way they differ is staleness, and the poll is the fresher of the two.
    getPeers.mockReturnValue({ allPeers: [peer('alice', 42n, true)], registeredPeers: [] });
    peerOnlineStatus.mockReturnValue(false);

    expect(isMemberOnline('alice')).toBe(false);
  });

  it('prefers a username match over a CID match for a numeric username', () => {
    // Nothing forbids a numeric username, and reading one as somebody else's
    // CID would be a fifth version of this bug.
    getPeers.mockReturnValue({
      allPeers: [peer('7', 99n), peer('carol', 7n)],
      registeredPeers: [],
    });
    peerOnlineStatus.mockImplementation((cid) => cid === 99n);

    expect(isMemberOnline('7')).toBe(true);
  });

  it('reports unknown, not offline, for a member the registry never heard of', () => {
    // "Offline" is an assertion about somebody who may be sitting right there.
    getPeers.mockReturnValue({ allPeers: [], registeredPeers: [] });

    expect(isMemberOnline('stranger')).toBeNull();
    expect(peerOnlineStatus).not.toHaveBeenCalled();
  });

  it('does not throw on any shape of member id', () => {
    getPeers.mockReturnValue({ allPeers: [], registeredPeers: [] });

    for (const id of ['', ' ', 'alice', '12', '-3', 'NaN', '12.5']) {
      expect(() => isMemberOnline(id), id).not.toThrow();
    }
  });

  it('still recognises a CID when one is passed', () => {
    expect(memberIdToCid('9007199254740993')).toBe(9007199254740993n);
    expect(memberIdToCid('alice')).toBeNull();
  });
});
