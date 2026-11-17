/**
 * Peer Registration Store - Persistence
 *
 * LocalDB read/write operations for pending and outgoing requests.
 * Uses generic helpers to avoid duplication between pending/outgoing variants.
 */

import { bytesToString } from '../utils/encoding-utils';
import { parsePersistedJSON } from '../storage-utils';

/**
 * Keys older builds wrote as bare strings via safeJSONStringify. New writes are
 * tagged, so this list only exists to rescue data already on disk.
 */
const PERSISTED_CID_FIELDS: readonly ["fromCid", "toCid", "cid", "peer_cid"] = ['fromCid', 'toCid', 'cid', 'peer_cid'] as const;
import { debugLog } from '@/lib/debug-config';
import type { PendingPeerRequest, OutgoingPeerRequest, KVPendingEntry } from './types';
import {
  STORAGE_KEY,
  OUTGOING_STORAGE_KEY
} from './constants';
import {
  pendingKey,
  outgoingKey,
  hasLegacyPending,
  hasLegacyOutgoing,
  ownPending,
  ownOutgoing,
} from './storage-keys';

import { localDBGet, localDBSet } from './local-db-client';
import type { LoadOutcome } from './local-db-client';
export { resetReadTracking } from './local-db-client';
export type { LoadOutcome } from './local-db-client';

// -- Public API --

export function persistPendingToLocalDB(
  requests: PendingPeerRequest[],
  kv: Map<string, KVPendingEntry>
): Promise<void> {
  return localDBSet(pendingKey(), requests, kv, 'pending');
}

/**
 * Load this account's incoming requests, from its own key and — once — from the
 * shared key older builds wrote.
 *
 * Both reads are filtered by owner. The scoped key cannot contain anyone else's
 * and the filter is free there; the legacy key contains EVERY account's, and
 * without it the second account on a device sees, and can accept, a contact
 * request addressed to the first.
 */
export function loadPendingFromLocalDB(
  kv: Map<string, KVPendingEntry>,
  onLoaded: (requests: PendingPeerRequest[]) => Promise<void>
): Promise<LoadOutcome> {
  return localDBGet<PendingPeerRequest>(
    pendingKey(), kv,
    async (data) => {
      await onLoaded(ownPending(data));
    },
    'pending',
  ).then(async (outcome) => {
    if (!hasLegacyPending()) return outcome;
    const legacy: LoadOutcome = await localDBGet<PendingPeerRequest>(
      STORAGE_KEY, kv,
      async (data) => {
        const mine: PendingPeerRequest[] = ownPending(data);
        if (mine.length > 0) await onLoaded(mine);
      },
      'pending (legacy)',
    );
    // Either read failing means the in-memory list is incomplete, and it is
    // completeness that licenses a whole-list write. The scoped read
    // succeeding does not make up for the legacy one failing.
    return outcome === 'failed' || legacy === 'failed' ? 'failed' : outcome;
  });
}

export function persistOutgoingToLocalDB(
  requests: OutgoingPeerRequest[],
  kv: Map<string, KVPendingEntry>
): Promise<void> {
  return localDBSet(outgoingKey(), requests, kv, 'outgoing');
}

export function loadOutgoingFromLocalDB(
  kv: Map<string, KVPendingEntry>,
  onLoaded: (requests: OutgoingPeerRequest[]) => Promise<void>
): Promise<LoadOutcome> {
  const accept = async (data: OutgoingPeerRequest[]): Promise<void> => {
    const valid: OutgoingPeerRequest[] = data.filter(r => r.toCid && r.fromCid);
    const invalidCount: number = data.length - valid.length;
    if (invalidCount > 0) {
      debugLog('PeerRegistrationStore', `Filtered out ${invalidCount} invalid outgoing requests`);
    }
    await onLoaded(ownOutgoing(valid));
  };

  return localDBGet<OutgoingPeerRequest>(outgoingKey(), kv, accept, 'outgoing').then(
    async (outcome) => {
      if (!hasLegacyOutgoing()) return outcome;
      const legacy: LoadOutcome = await localDBGet<OutgoingPeerRequest>(
        OUTGOING_STORAGE_KEY, kv,
        async (data) => {
          const mine: OutgoingPeerRequest[] = ownOutgoing(data.filter(r => r.toCid && r.fromCid));
          if (mine.length > 0) await onLoaded(mine);
        },
        'outgoing (legacy)',
      );
      return outcome === 'failed' || legacy === 'failed' ? 'failed' : outcome;
    },
  );
}

/** Resolve a LocalDB get KV response */
export function resolveKVResponse(
  kv: Map<string, KVPendingEntry>,
  requestId: string,
  value: number[] | undefined
): void {
  const pending: KVPendingEntry | undefined = kv.get(requestId);
  if (!pending) return;
  kv.delete(requestId);
  try {
    if (value && value.length > 0) {
      // parsePersistedJSON, not JSON.parse: fromCid/toCid/cid/peer_cid are
      // typed bigint and every lookup in state.ts compares them with ===, so
      // strings coming back here made incoming requests invisible to the UI
      // and the badge, and outgoing ones impossible to dedupe or remove.
      pending.resolve(parsePersistedJSON(bytesToString(value), PERSISTED_CID_FIELDS));
    } else {
      pending.resolve(null);
    }
  } catch (error) {
    debugLog('PeerRegistrationStore', 'Failed to parse LocalDB value:', error);
    pending.resolve(null);
  }
}

/** Resolve a LocalDB set KV success */
export function resolveKVSetSuccess(
  kv: Map<string, KVPendingEntry>,
  requestId: string
): void {
  const pending: KVPendingEntry | undefined = kv.get(requestId);
  if (pending) { kv.delete(requestId); pending.resolve(undefined); }
}

/** Reject a LocalDB KV failure */
export function rejectKVFailure(
  kv: Map<string, KVPendingEntry>,
  requestId: string,
  message: string
): void {
  const pending: KVPendingEntry | undefined = kv.get(requestId);
  if (pending) { kv.delete(requestId); pending.reject(new Error(message || 'LocalDB operation failed')); }
}
