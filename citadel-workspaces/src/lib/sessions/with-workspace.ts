import type { ActiveSession, PeerSessionInformation } from '@/types/session-types';
import type { OrphanSessionWithWorkspace } from '@/components/useOrphanSessions';
import { sessionIsOnServer } from '@/lib/sessions/same-server';

/** One live session paired with the stored record that names its workspace. */
interface Paired {
  workspaceName: string;
  storedSessionIndex: number;
  lastAccessed: number;
  cid: bigint;
  username: string;
  server_address: string;
  full_name?: string;
  peer_connections?: Record<string, PeerSessionInformation>;
}

/** Just the fields this pairing needs from a stored session. */
interface StoredLike {
  username: string;
  serverAddress: string;
}

/**
 * Pair each live session with the stored record that names its workspace, and
 * order them by when the user last used them.
 *
 * Pure, and separate from the hook, so the ordering rule can be read and tested
 * without standing up a connection manager. `lastAccessed` comes from
 * localStorage rather than the session itself: the backend has no notion of
 * which of your sessions you looked at most recently, and that is the order the
 * navbar wants.
 */
export function withWorkspaceNames(
  activeSessions: ActiveSession[],
  storedSessions: StoredLike[],
  readLastAccessed: (cid: ActiveSession['cid']) => number,
): OrphanSessionWithWorkspace[] {
  // A session with no CID is dropped, not rendered.
  //
  // `ActiveSession.cid` is declared `bigint` and the wire does not always carry
  // one. Such a session cannot be navigated to, claimed, or signed out of --
  // every one of those is keyed by CID -- so a chip for it is a control that
  // does nothing. It reached the strip, and pressing sign-out on it called
  // `disconnect(undefined)`, ran the modal through to "ready", and left the
  // chip in place: an action that reported success.
  //
  // Dropping is not the same as emptying. A stale list beats an empty one here
  // and that is why a failed READ is never treated as "no sessions"; this
  // removes only the entries that cannot be acted on.
  const usable: ActiveSession[] = activeSessions.filter((session) => session.cid !== undefined);

  const paired: Paired[] = usable.map((activeSession): Paired => {
    const storedIndex: number = storedSessions.findIndex(
      (stored) =>
        stored.username === activeSession.username &&
        sessionIsOnServer(activeSession, stored.serverAddress),
    );
    const storedSession: StoredLike = storedSessions[storedIndex];

    return {
      ...activeSession,
      workspaceName: storedSession?.username || activeSession.username,
      storedSessionIndex: storedIndex,
      lastAccessed: readLastAccessed(activeSession.cid),
    };
  });

  return paired.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
}
