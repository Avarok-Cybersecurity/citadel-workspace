import { describe, it, expect, vi, beforeEach  } from 'vitest';

// The registration roster is a network-backed singleton; this is the seam
// between the resolver's rule (which record wins, what happens when none does)
// and the service that supplies the records. Mocking it keeps the rule
// testable without standing up a peer registration.
const getPeers: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: { getPeers: (): unknown => getPeers() },
}));

const { rosterPeerName } = await import('../roster-peer-name');

const peer: (cid: bigint, username: string, fullName?: string) => { cid: bigint; username: string; fullName: string; isOnline: boolean; isRegistered: boolean; } = (cid: bigint, username: string, fullName = ''): { cid: bigint; username: string; fullName: string; isOnline: boolean; isRegistered: boolean; } => ({
  cid,
  username,
  fullName,
  isOnline: true,
  isRegistered: true,
});

describe('rosterPeerName', () => {
  beforeEach(() => getPeers.mockReset());

  it('names a registered peer', () => {
    getPeers.mockReturnValue({ registeredPeers: [peer(7n, 'alice')], allPeers: [] });
    expect(rosterPeerName(7n)).toBe('alice');
  });

  it('prefers a full name when the roster has one', () => {
    getPeers.mockReturnValue({ registeredPeers: [peer(7n, 'alice', 'Alice Ng')], allPeers: [] });
    expect(rosterPeerName(7n)).toBe('Alice Ng');
  });

  it('falls back to a discovered peer that is not yet registered', () => {
    getPeers.mockReturnValue({ registeredPeers: [], allPeers: [peer(7n, 'alice')] });
    expect(rosterPeerName(7n)).toBe('alice');
  });

  it('prefers the registered record when a peer appears in both', () => {
    getPeers.mockReturnValue({
      registeredPeers: [peer(7n, 'alice')],
      allPeers: [peer(7n, 'stale-alice')],
    });
    expect(rosterPeerName(7n)).toBe('alice');
  });

  it('gives an unknown peer a short handle, never the raw cid', () => {
    // The point of the whole module: a caller nobody has registered with is
    // still not a twenty-digit number on screen.
    getPeers.mockReturnValue({ registeredPeers: [], allPeers: [] });
    const cid: bigint = 13961676296247425873n;

    const name: string = rosterPeerName(cid);
    expect(name).not.toBe(cid.toString());
    expect(name).toMatch(/^Peer /);
  });
});
