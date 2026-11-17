/**
 * What a paused contact is, as data, and what it permits.
 *
 * A pause is per (our session, their session) and lives in the agent's LocalDB
 * under the local session's CID, one key per peer: set on pause, deleted on
 * resume. One key per peer rather than one list per session so two tabs
 * pausing two different contacts cannot overwrite each other's write.
 *
 * Pure: no I/O. The store reads and writes; this decides what was read.
 */
import { bytesToString } from '@/lib/utils/encoding-utils';
import { isGenuinelyAbsent } from '@/lib/storage/absence';

/** `unknown`: the record could not be read, so nobody knows. */
export type PauseStatus = 'paused' | 'active' | 'unknown';

/** How to answer a contact's incoming PeerConnect. */
export type IncomingAnswer = 'accept' | 'decline' | 'ignore';

export const PAUSED_MARKER: 'paused' = 'paused';

const PAUSE_KEY_PREFIX: 'p2p_paused_peer_' = 'p2p_paused_peer_';

export function pauseKey(peerCid: bigint): string {
  return `${PAUSE_KEY_PREFIX}${peerCid.toString()}`;
}

/** A stored value that is not the marker is not a pause anybody made. */
export function statusFromStored(stored: { value: number[] } | null): PauseStatus {
  if (stored === null) return 'active';
  return bytesToString(stored.value) === PAUSED_MARKER ? 'paused' : 'unknown';
}

/** The agent rejects an absent key; that, and only that, means "not paused". */
export function statusFromReadError(error: unknown): PauseStatus {
  return isGenuinelyAbsent(error) ? 'active' : 'unknown';
}

/**
 * Only a contact known not to be paused is dialled. An unreadable record is
 * not permission: dialling then would silently undo the user's pause, and the
 * periodic auto-connect poll asks again in seconds.
 */
export function mayDial(status: PauseStatus): boolean {
  return status === 'active';
}

/**
 * A paused contact is declined, which ends their attempt at once instead of
 * leaving it to time out. When unsure, no answer: they retry, and by then the
 * record may be readable.
 */
export function answerFor(status: PauseStatus): IncomingAnswer {
  switch (status) {
    case 'paused': return 'decline';
    case 'unknown': return 'ignore';
    case 'active': return 'accept';
  }
}
