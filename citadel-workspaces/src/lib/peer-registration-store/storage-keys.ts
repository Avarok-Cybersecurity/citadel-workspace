import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { STORAGE_KEY, OUTGOING_STORAGE_KEY } from './constants';
import type { PendingPeerRequest, OutgoingPeerRequest } from './types';

/**
 * Where one account's contact requests are stored.
 *
 * Both lists were written to flat keys — `pending_peer_requests` and
 * `outgoing_peer_requests` — in LocalDB bucket `0n`, which every account on the
 * device shares. On a product that explicitly expects several accounts in one
 * browser, that means one account's incoming contact requests appear in
 * another's list, and the second account can accept a request that was
 * addressed to the first. Accepting establishes a real P2P registration under
 * the wrong CID.
 *
 * This is the same defect that message pages had, fixed the same way: the owner
 * goes in the KEY, so the sharing is removed rather than policed. The legacy
 * key stays readable so requests already on disk are not orphaned — and because
 * that read returns everyone's, the loaders filter it by owner too.
 */
export function pendingKey(): string {
  const own: bigint | null = instanceManager.cid;
  // No session yet: the legacy shape rather than an invented owner. A record
  // filed under a guessed account is worse than an unscoped one.
  return own ? `${STORAGE_KEY}_${own.toString()}` : STORAGE_KEY;
}

export function outgoingKey(): string {
  const own: bigint | null = instanceManager.cid;
  return own ? `${OUTGOING_STORAGE_KEY}_${own.toString()}` : OUTGOING_STORAGE_KEY;
}

/** True when a scoped key is in use, i.e. the legacy key is worth reading too. */
export function hasLegacyPending(): boolean {
  return pendingKey() !== STORAGE_KEY;
}

export function hasLegacyOutgoing(): boolean {
  return outgoingKey() !== OUTGOING_STORAGE_KEY;
}

/**
 * Keep only the requests that belong to this account.
 *
 * Applied to every read, not only the legacy one. The scoped key makes mixing
 * impossible going forward; this makes the legacy key — which holds every
 * account's requests — safe to read, and would catch a future key that forgot
 * to scope itself.
 *
 * With no session established nothing is claimed: an empty list is correct,
 * because there is no account for these to belong to yet.
 */
export function ownPending(requests: PendingPeerRequest[]): PendingPeerRequest[] {
  const own: bigint | null = instanceManager.cid;
  if (own === null) return [];
  return requests.filter((r) => r.cid === own);
}

export function ownOutgoing(requests: OutgoingPeerRequest[]): OutgoingPeerRequest[] {
  const own: bigint | null = instanceManager.cid;
  if (own === null) return [];
  return requests.filter((r) => r.fromCid === own);
}
