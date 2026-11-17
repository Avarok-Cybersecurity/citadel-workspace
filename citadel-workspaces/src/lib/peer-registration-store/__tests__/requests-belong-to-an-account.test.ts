/**
 * One account must not see, or accept, another account's contact requests.
 *
 * Both lists were written to flat keys — `pending_peer_requests` and
 * `outgoing_peer_requests` — in LocalDB bucket `0n`, which every account on the
 * device shares. On a product that explicitly expects several accounts in one
 * browser, that put one account's incoming contact requests in another's list.
 * Accepting one there establishes a real P2P registration under the wrong CID.
 *
 * Message pages had exactly this defect and were fixed by putting the owner in
 * the key. This is the same fix, in the subsystem next door.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { instanceManager } = vi.hoisted(() => ({
  instanceManager: { cid: null as bigint | null },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return instanceManager.cid; } }) };
});

import {
  pendingKey,
  outgoingKey,
  hasLegacyPending,
  ownPending,
  ownOutgoing,
} from '../storage-keys';
import type { PendingPeerRequest, OutgoingPeerRequest } from '../types';

const incoming = (to: bigint): PendingPeerRequest => ({
  id: `to-${to}`, peer_cid: 99n, peer_username: 'someone', timestamp: 0, cid: to,
});
const sent = (from: bigint): OutgoingPeerRequest => ({
  id: `from-${from}`, fromCid: from, toCid: 99n, peerUsername: 'someone',
  timestamp: 0, timeLastSent: 0,
});

describe('the storage key', () => {
  beforeEach(() => { instanceManager.cid = null; });

  it('names the account, so two accounts cannot share a list', () => {
    instanceManager.cid = 111n;
    const a: { pending: string; outgoing: string; } = { pending: pendingKey(), outgoing: outgoingKey() };
    instanceManager.cid = 222n;
    expect(pendingKey()).not.toBe(a.pending);
    expect(outgoingKey()).not.toBe(a.outgoing);
  });

  it('falls back to the shared key with no session, rather than inventing an owner', () => {
    // A record filed under a guessed account is worse than an unscoped one.
    expect(pendingKey()).toBe('pending_peer_requests');
    expect(outgoingKey()).toBe('outgoing_peer_requests');
    expect(hasLegacyPending()).toBe(false);
  });

  it('reports a legacy key worth reading once scoped', () => {
    instanceManager.cid = 111n;
    expect(hasLegacyPending()).toBe(true);
  });
});

describe('filtering a shared list', () => {
  beforeEach(() => { instanceManager.cid = 111n; });

  it('keeps only requests addressed to this account', () => {
    expect(ownPending([incoming(111n), incoming(222n)]).map((r) => r.id))
      .toEqual(['to-111']);
  });

  it('keeps only requests this account sent', () => {
    expect(ownOutgoing([sent(111n), sent(222n)]).map((r) => r.id))
      .toEqual(['from-111']);
  });

  it('claims nothing when there is no session', () => {
    // Not "everything": with no account established there is nobody for these
    // to belong to, and showing another account's is the whole bug.
    instanceManager.cid = null;
    expect(ownPending([incoming(111n), incoming(222n)])).toEqual([]);
    expect(ownOutgoing([sent(111n)])).toEqual([]);
  });
});
