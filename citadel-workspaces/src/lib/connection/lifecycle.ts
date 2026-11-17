/**
 * Connection Lifecycle
 *
 * Handles successful connection processing, disconnect,
 * and account switching for the ConnectionManager.
 */

import type { ConnectionState } from './state';
import { selectUserWithoutBlocking } from './select-user';
import type { ConnectionIO } from './io';
import type { StoredSession } from '@/types/session-types';
import { storeSession } from './session-management';
import { debugLog } from '@/lib/debug-config';
import { storedSessionServer } from './stored-server';
import { connectionStoredServerIO } from './stored-server-io';

/**
 * Handle a successful connection by updating state and notifying services.
 */
export async function handleSuccessfulConnection(
  cid: bigint,
  shouldUpdateStoredSession: boolean,
  state: ConnectionState,
  io: ConnectionIO,
): Promise<void> {
  // MERGED, not assigned.
  //
  // This arrives from the WebSocket when a ConnectSuccess lands, and it knows
  // only the CID. Assigning `{ cid }` replaces whatever was there -- including
  // the `username` that `handleAuthSuccess` writes -- so a second success for
  // the same session leaves the record CID-only.
  //
  // `permissionsService.getCurrentUserId()` reads exactly that username, and
  // its comment records the consequence without the cause: "the synchronous
  // accessor is null for a user who logged IN rather than registering". A null
  // there is a permissions fetch that cannot say who it is for, and CI reports
  // it as the workspace administrator's own Edit button, disabled for sixty
  // seconds, over a title reading "Permissions have not been loaded for this
  // domain".
  //
  // Same shape as the workspace metadata, which is shared with theming and was
  // being assigned over: a partial write to a shared record has to merge.
  state.updateCurrentConnectionInfo({ cid });
  debugLog('ConnectionService', 'ConnectionManager: Handling successful connection', cid.toString(), 'shouldUpdateStoredSession:', shouldUpdateStoredSession);

  io.setInstanceCid(cid);
  io.announcePresence();
  state.resetReconnectAttempts();

  if (!shouldUpdateStoredSession) {
    debugLog('ConnectionService', 'ConnectionManager: Skipping connection notifications - handleAuthSuccess will handle them');
    return;
  }

  // Update stored session with CID
  let sessionUsername: string | undefined;
  if (state.storedSessions.sessions.length > 0) {
    const activeIndex: number = state.getActiveSessionIndex();
    const session: StoredSession = state.storedSessions.sessions[activeIndex];
    if (session) {
      session.cid = cid;
      session.lastConnected = Date.now();
      sessionUsername = session.username;
      await storeSession(session, state, io);
      debugLog('ConnectionService', 'ConnectionManager: Updated stored session with CID:', cid.toString());
    }
  }

  io.setWorkspaceConnectionId(cid);
  io.updateConnectionService({ cid, isConnected: true });
  io.broadcastConnectionStatus({ isConnected: true, cid });

  if (sessionUsername) {
    io.emitEvent('auth:success', { cid, username: sessionUsername });
  }
}

/**
 * Disconnect a session from the server.
 */
export async function disconnectSession(
  session: { cid: bigint; username?: string; serverAddress?: string } | undefined,
  state: ConnectionState,
  io: ConnectionIO,
): Promise<void> {
  const cid: bigint | undefined = session?.cid ?? state.currentConnectionInfo?.cid;
  const username: string | undefined = session?.username ?? state.currentConnectionInfo?.username;
  const serverAddress: string | undefined = session?.serverAddress ?? state.currentConnectionInfo?.serverAddress;

  if (!cid) {
    debugLog('ConnectionService', 'disconnect() called but no CID available - skipping backend disconnect');
    state.setCurrentConnectionInfo(null);
    state.invalidateCache();
    io.updateConnectionService({ cid: null, isConnected: false });
    io.broadcastConnectionStatus({ isConnected: false });
    return;
  }

  debugLog('ConnectionService', 'ConnectionManager: Disconnecting session with CID:', cid.toString());

  // The MEMORY mark first, the disconnect second, the write last.
  //
  // These three used to be two: `markUserDisconnected` recorded the intent and
  // persisted it in one awaited call, ahead of the disconnect. So a LocalDB
  // write that took five seconds to time out held up a sign-out — the same
  // shape as rounds 189 and 190, found here by the guard those two produced.
  //
  // Swapping them outright would have been wrong. `handleDisconnect` schedules
  // a reconnect a second after the disconnect notification and consults the
  // in-memory set to decide whether to skip it, so the mark has to be in place
  // BEFORE the disconnect or auto-reconnect can revive the session the user
  // just left. Only the persistence — which exists so the decision survives a
  // reload, and has no deadline — moves after.
  if (username && serverAddress) {
    io.markUserDisconnectedNow(username, serverAddress);
  }
  await io.disconnect(cid);
  if (username && serverAddress) {
    await io.persistUserDisconnected();
  }

  state.setCurrentConnectionInfo(null);
  state.invalidateCache();
  io.updateConnectionService({ cid: null, isConnected: false });
  io.broadcastConnectionStatus({ isConnected: false });
}

/**
 * Switch the current tab to a different account.
 */
export async function switchAccount(
  username: string,
  serverAddress: string,
  state: ConnectionState,
  io: ConnectionIO,
  disconnectFn: () => Promise<void>,
  storeSessionFn: (session: StoredSession) => Promise<void>,
): Promise<void> {
  const session: StoredSession | undefined = state.findSession(username, serverAddress);
  if (!session) {
    throw new Error('Session not found');
  }

  debugLog('ConnectionService', `ConnectionManager: Switching account to ${username}@${serverAddress} for this tab`);

  // Not a bare await. This writes tab context to IndexedDB, which can stall,
  // and a stalled write here meant the user pressed a workspace icon and
  // nothing happened -- the old account still on screen, no error, no switch.
  // handleAuthSuccess already raced this call against a timeout for exactly
  // that reason; this is the same call in the next file over, and it did not.
  await selectUserWithoutBlocking(io, {
    selectedUsername: username,
    selectedServerAddress: serverAddress,
    selectedCid: session.cid,
  }, (selected): void => {
    // Merged, not assigned: `currentConnectionInfo` is shared with the CID that
    // ConnectSuccess writes, and assigning over it is what round 300 fixed.
    state.updateCurrentConnectionInfo({
      username: selected.username,
      serverAddress: selected.serverAddress,
      ...(selected.cid === undefined ? {} : { cid: selected.cid }),
    });
  });

  if (state.isLeader) {
    await disconnectFn();

    if (!session.password) {
      // The user declined credential storage, so there is nothing to sign in
      // with. Say so instead of sending an empty password and surfacing an
      // authentication failure they cannot act on.
      throw new Error(
        `Cannot reconnect ${session.username} automatically: credentials were not saved. Please sign in again.`,
      );
    }

    const serverAddress: string = await storedSessionServer(session, connectionStoredServerIO(state, io));
    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    await io.connect({
      requestId,
      username: session.username,
      serverAddress,
      password: session.password,
      sessionSecuritySettings: session.sessionSecuritySettings,
    });

    session.lastConnected = Date.now();
    await storeSessionFn(session);
  } else {
    debugLog('ConnectionService', 'ConnectionManager: Follower tab - updating selected user without reconnecting');
  }
}
