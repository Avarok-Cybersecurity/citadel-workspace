/**
 * Older sign-ins stored a session with `serverAddress: ""` (see session-label). Sessions
 * are keyed by username AND server, so once the same account signed in again with its
 * address the two records sat side by side, and Manage Accounts listed it twice.
 *
 * A serverless record is dropped only when its username also has an addressed one: on
 * its own it is still the only way back to that account, and liveSessionCid can match it.
 */
import type { StoredSession } from '@/types/session-types';

export function dropUnaddressedDuplicates(sessions: readonly StoredSession[]): { sessions: StoredSession[]; removed: number } {
  const addressed: Set<string> = new Set(
    sessions.filter((s: StoredSession) => s.serverAddress.trim() !== '').map((s: StoredSession) => s.username),
  );
  const kept: StoredSession[] = sessions.filter((s: StoredSession) => s.serverAddress.trim() !== '' || !addressed.has(s.username));
  return { sessions: kept, removed: sessions.length - kept.length };
}
