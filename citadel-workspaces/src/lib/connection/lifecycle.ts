/**
 * Connection Lifecycle
 *
 * Handles successful connection processing and disconnect for the ConnectionManager.
 */

import type { ConnectionState } from './state';
import type { ConnectionIO } from './io';
import type { StoredSession } from '@/types/session-types';
import { storeSession } from './session-management';
import { debugLog } from '@/lib/debug-config';

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

  if (!shouldUpdateStoredSession) {
    debugLog('ConnectionService', 'ConnectionManager: Skipping connection notifications - handleAuthSuccess will handle them');
    return;
  }

  // Update stored session with CID
  if (state.storedSessions.sessions.length > 0) {
    const activeIndex: number = state.getActiveSessionIndex();
    const session: StoredSession = state.storedSessions.sessions[activeIndex];
    if (session) {
      session.cid = cid;
      session.lastConnected = Date.now();
      await storeSession(session, state, io);
      debugLog('ConnectionService', 'ConnectionManager: Updated stored session with CID:', cid.toString());
    }
  }

  io.setWorkspaceConnectionId(cid);
  io.updateConnectionService({ cid, isConnected: true });
  io.broadcastConnectionStatus({ isConnected: true, cid });
}

/**
 * Disconnect a session from the server.
 */
export async function disconnectSession(
  session: { cid: bigint } | undefined,
  state: ConnectionState,
  io: ConnectionIO,
): Promise<void> {
  const cid: bigint | undefined = session?.cid ?? state.currentConnectionInfo?.cid;

  if (!cid) {
    debugLog('ConnectionService', 'disconnect() called but no CID available - skipping backend disconnect');
    state.setCurrentConnectionInfo(null);
    state.invalidateCache();
    io.updateConnectionService({ cid: null, isConnected: false });
    io.broadcastConnectionStatus({ isConnected: false });
    return;
  }

  debugLog('ConnectionService', 'ConnectionManager: Disconnecting session with CID:', cid.toString());

  await io.disconnect(cid);

  state.setCurrentConnectionInfo(null);
  state.invalidateCache();
  io.updateConnectionService({ cid: null, isConnected: false });
  io.broadcastConnectionStatus({ isConnected: false });
}
