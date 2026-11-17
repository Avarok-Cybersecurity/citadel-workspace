/**
 * Connection Auto-Reconnect
 *
 * Handles auto-reconnect logic, leader connection attempts,
 * and session-already-connected error recovery.
 */

import type { ConnectionState } from './state';
import { isConnectAlreadyInProgress } from '@/lib/connection/is-connect-in-progress';
import type { ConnectionIO } from './io';
import type { StoredSession, ActiveSession } from '@/types/session-types';
import { storeSession } from './session-management';
import {
  HEALTH_CHECK_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
} from './constants';
import { debugLog } from '@/lib/debug-config';
import type { TabSelectionContext } from '@/lib/connection/types';
import { sessionIsOnServer } from '@/lib/sessions/same-server';

/**
 * Attempt leader connection if conditions are met.
 */
export async function attemptLeaderConnection(
  state: ConnectionState,
  io: ConnectionIO,
  getActiveSessions: () => Promise<ActiveSession[]>,
  doAutoReconnect: (sessions: ActiveSession[]) => Promise<void>,
): Promise<void> {
  if (!state.isInitialized) {
    debugLog('ConnectionService', 'ConnectionManager: Not initialized yet, skipping leader connection');
    return;
  }
  if (!state.isLeader) {
    debugLog('ConnectionService', 'ConnectionManager: Not the leader, skipping connection attempt');
    return;
  }

  const activeSessions: ActiveSession[] = await getActiveSessions();
  await doAutoReconnect(activeSessions);
}

/**
 * Auto-reconnect to a stored session if appropriate.
 */
export async function autoReconnect(
  activeSessions: ActiveSession[],
  state: ConnectionState,
  io: ConnectionIO,
  getActiveSessions: () => Promise<ActiveSession[]>,
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

  const connectionKey: string = state.createConnectionKey(session.username, session.serverAddress);
  if (state.hasConnectionAttempt(connectionKey)) {
    debugLog('ConnectionService', `ConnectionManager: Connection already in progress for ${connectionKey}`);
    return;
  }

  // Check if session is already active
  const freshActiveSessions: ActiveSession[] = await getActiveSessions();
  const alreadyActive: ActiveSession | undefined = freshActiveSessions.find(
    (s) => s.username === session!.username && sessionIsOnServer(s, session!.serverAddress)
  );

  if (alreadyActive) {
    await reuseExistingSession(alreadyActive, session, state, io, handleSuccessConn);
    return;
  }

  debugLog('ConnectionService', 'ConnectionManager: Attempting auto-reconnect for', session.username);
  try {
    state.addConnectionAttempt(connectionKey);
    await performAutoReconnect(session, activeSessions, state, io, handleSuccessConn, getActiveSessions);
  } finally {
    state.removeConnectionAttempt(connectionKey);
  }
}

async function reuseExistingSession(
  activeSession: ActiveSession,
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

async function performAutoReconnect(
  session: StoredSession,
  activeSessions: ActiveSession[],
  state: ConnectionState,
  io: ConnectionIO,
  handleSuccessConn: (cid: bigint, shouldUpdate: boolean) => Promise<void>,
  getActiveSessions: () => Promise<ActiveSession[]>,
): Promise<void> {
  try {
    try {
      await io.waitForHealthy(HEALTH_CHECK_TIMEOUT_MS);
    } catch (healthError) {
      debugLog('ConnectionService', 'Service health check failed, attempting anyway:', healthError);
    }

    if (!session.password) {
      // See lifecycle.ts: no stored password means no silent reconnect.
      throw new Error(
        `Cannot reconnect ${session.username} automatically: credentials were not saved. Please sign in again.`,
      );
    }

    // Never empty here: autoReconnect only reaches a session the tab selected by a non-empty
    // server (a record without one is never selected; stored-server.ts is for paths that can).
    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    await io.connect({
      requestId,
      username: session.username,
      serverAddress: session.serverAddress,
      password: session.password,
      sessionSecuritySettings: session.sessionSecuritySettings,
    });

    session.lastConnected = Date.now();
    await storeSession(session, state, io);
    debugLog('ConnectionService', 'ConnectionManager: Auto-reconnect successful');
  } catch (error: unknown) {
    debugLog('ConnectionService', 'Auto-reconnect failed', error);
    await handleAutoReconnectError(error, session, activeSessions, state, io, handleSuccessConn, getActiveSessions);
  }
}

async function handleAutoReconnectError(
  error: unknown,
  session: StoredSession,
  activeSessions: ActiveSession[],
  state: ConnectionState,
  io: ConnectionIO,
  handleSuccessConn: (cid: bigint, shouldUpdate: boolean) => Promise<void>,
  getActiveSessions: () => Promise<ActiveSession[]>,
): Promise<void> {
  io.updateConnectionService({ cid: null, isConnected: false });
  io.broadcastConnectionStatus({ isConnected: false });

  const errorMessage: string = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (isConnectAlreadyInProgress(errorMessage)) {
    await handleSessionAlreadyConnectedError(error, session, state, io, getActiveSessions);
    state.resetReconnectAttempts();
    return;
  }

  if (!state.hasReachedMaxReconnectAttempts()) {
    const attempts: number = state.incrementReconnectAttempts();
    const delay: number = state.calculateBackoffDelay(attempts, MAX_RECONNECT_DELAY_MS);
    debugLog('ConnectionService', `ConnectionManager: Will retry in ${delay}ms (attempt ${attempts}/${state.maxReconnectAttempts})`);

    setTimeout(async () => {
      await autoReconnect(activeSessions, state, io, getActiveSessions, handleSuccessConn);
    }, delay);
  } else {
    debugLog('ConnectionService', 'ConnectionManager: Max reconnection attempts reached, giving up');
  }
}

async function handleSessionAlreadyConnectedError(
  error: unknown,
  session: StoredSession,
  state: ConnectionState,
  io: ConnectionIO,
  getActiveSessions: () => Promise<ActiveSession[]>,
): Promise<void> {
  debugLog('ConnectionService', 'ConnectionManager: Session already connected error - likely stale session');

  const errorMessage: string = error instanceof Error ? error.message : String(error);
  const extractedCid: string | null = state.extractCidFromErrorMessage(errorMessage);
  if (extractedCid) {
    io.emitEvent('session-already-connected', { cid: extractedCid, message: errorMessage });
    return;
  }

  try {
    const sessions: ActiveSession[] = await getActiveSessions();
    const match: ActiveSession | undefined = sessions.find(
      (s) => s.username === session.username && sessionIsOnServer(s, session.serverAddress)
    );
    if (match) {
      io.emitEvent('session-already-connected', {
        cid: match.cid.toString(),
        message: errorMessage,
      });
    }
  } catch (err) {
    debugLog('ConnectionService', 'Failed to get active sessions:', err);
  }
}
