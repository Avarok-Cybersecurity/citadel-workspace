/**
 * Connection Auto-Reconnect
 *
 * Rejoins the tab-selected session when the agent still holds it, and the
 * leader's connection attempt that does so.
 */

import type { ConnectionState } from './state';
import type { ConnectionIO } from './io';
import type { StoredSession } from '@/types/session-types';
import type { SessionInformation } from 'citadel-workspace-client-ts';
import { storeSession } from './session-management';
import { debugLog } from '@/lib/debug-config';
import type { TabSelectionContext } from '@/lib/connection/types';
import { sessionIsOnServer } from '@/lib/sessions/same-server';

/**
 * Attempt leader connection if conditions are met.
 */
export async function attemptLeaderConnection(
  state: ConnectionState,
  io: ConnectionIO,
  getActiveSessions: () => Promise<SessionInformation[]>,
  doAutoReconnect: (sessions: SessionInformation[]) => Promise<void>,
): Promise<void> {
  if (!state.isInitialized) {
    debugLog('ConnectionService', 'ConnectionManager: Not initialized yet, skipping leader connection');
    return;
  }
  if (!state.isLeader) {
    debugLog('ConnectionService', 'ConnectionManager: Not the leader, skipping connection attempt');
    return;
  }

  const activeSessions: SessionInformation[] = await getActiveSessions();
  await doAutoReconnect(activeSessions);
}

/**
 * Auto-reconnect to a stored session if appropriate.
 */
export async function autoReconnect(
  activeSessions: SessionInformation[],
  state: ConnectionState,
  io: ConnectionIO,
  getActiveSessions: () => Promise<SessionInformation[]>,
  handleSuccessConn: (cid: bigint, shouldUpdate: boolean) => Promise<void>,
): Promise<void> {
  if (state.storedSessions.sessions.length === 0) return;

  if (!state.isLeader) {
    debugLog('ConnectionService', 'ConnectionManager: Not the leader, skipping auto-reconnect');
    return;
  }

  const tabSelection: TabSelectionContext | null = await io.getSelectedUser();
  let session: StoredSession | undefined;

  if (tabSelection?.selectedUsername && tabSelection?.selectedServerAddress) {
    session = state.findSession(tabSelection.selectedUsername, tabSelection.selectedServerAddress);
    debugLog('ConnectionService', 'ConnectionManager: Auto-reconnecting with tab-selected user:', tabSelection.selectedUsername);
  } else {
    debugLog('ConnectionService', 'ConnectionManager: No tab-specific selection, skipping auto-reconnect');
    return;
  }

  if (!session) return;

  // Check if session is already active
  const freshActiveSessions: SessionInformation[] = await getActiveSessions();
  const alreadyActive: SessionInformation | undefined = freshActiveSessions.find(
    (s) => s.username === session!.username && sessionIsOnServer(s, session!.serverAddress)
  );

  if (alreadyActive) {
    await reuseExistingSession(alreadyActive, session, state, io, handleSuccessConn);
    return;
  }
  // Nothing on this device can sign a session back in: no credential is kept. The sign-in form does it.
  debugLog('ConnectionService', 'ConnectionManager: Stored session is not active; it needs a sign-in:', session.username);
}

async function reuseExistingSession(
  activeSession: SessionInformation,
  session: StoredSession,
  state: ConnectionState,
  io: ConnectionIO,
  handleSuccessConn: (cid: bigint, shouldUpdate: boolean) => Promise<void>,
): Promise<void> {
  debugLog('ConnectionService', 'ConnectionManager: Session already active, skipping Connect to prevent ratchet reset');
  await handleSuccessConn(activeSession.cid, false);

  state.setCurrentConnectionInfo({
    cid: activeSession.cid,
    username: session.username,
    serverAddress: session.serverAddress,
    fullName: session.fullName,
  });

  session.cid = activeSession.cid;
  session.lastConnected = Date.now();
  await storeSession(session, state, io);
  debugLog('ConnectionService', 'ConnectionManager: Reusing existing session instead of reconnecting');
}
