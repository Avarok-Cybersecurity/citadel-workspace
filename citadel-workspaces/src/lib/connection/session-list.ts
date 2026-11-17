/**
 * Removing sessions from the stored list.
 *
 * Split from session-management.ts, which crossed the 250-line cap when logout
 * grew the reasoning for why a disconnect must not be gated on a local write.
 *
 * Each of these mutates memory first and then persists, which is the ordering
 * that makes a storage failure survivable: the list the user sees is already
 * correct, and only the record of it for next time is at risk.
 */

import type { ConnectionState } from './state';
import type { ConnectionIO } from './io';
import { debugLog } from '@/lib/debug-config';
import { persistSessionRemoval } from './persist-one-session';

/** Remove a single session from state and persist. */
export async function removeSession(
  username: string, serverAddress: string,
  state: ConnectionState, io: ConnectionIO,
): Promise<void> {
  state.removeSession(username, serverAddress);
  // One session, not this tab's whole list. A whole-list write here also
  // resurrected accounts another tab had removed, and erased ones it had added.
  await persistSessionRemoval(username, serverAddress, state.storedSessions, io);
}

/**
 * Remove all sessions and disconnect if active.
 *
 * Disconnect first, for the reason given on `handleLogout`: a failed local
 * write must not leave the user connected to a server they have just removed
 * every session for.
 */
export async function removeAllSessions(
  state: ConnectionState, io: ConnectionIO, disconnectFn: () => Promise<void>,
): Promise<void> {
  const wasConnected: boolean = Boolean(state.currentConnectionInfo);
  state.clearSessions();
  if (wasConnected) await disconnectFn();
  try {
    await io.storeSessionsToLocalDB(state.storedSessions);
  } catch (error) {
    debugLog('ConnectionService', 'Could not persist sessions after removing all', error);
  }
}

/** Clear all stored sessions and persist. */
export async function clearStoredSessions(
  state: ConnectionState, io: ConnectionIO,
): Promise<void> {
  state.clearSessions();
  await io.storeSessionsToLocalDB(state.storedSessions);
}
