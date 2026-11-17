/**
 * Connection Message Handling
 *
 * Handles WebSocket message routing and response resolution
 * for the ConnectionManager.
 */

import type { ConnectionState } from './state';
import type { ConnectionIO } from './io';
import type { WebSocketMessage } from '@/types/ws-message-types';
import { debugLog } from '@/lib/debug-config';
import type { TabSelectionContext, PendingRequest } from '@/lib/connection/types';

/**
 * Route an incoming WebSocket message to the appropriate handler.
 * Resolves pending requests and processes auth/disconnect events.
 */
export async function handleWebSocketMessage(
  message: WebSocketMessage,
  state: ConnectionState,
  io: ConnectionIO,
  onSuccessfulConnection: (cid: bigint, shouldUpdate: boolean) => Promise<void>,
  onConnectFailure: (failure: { message?: string }) => Promise<void>,
): Promise<void> {
  const msg: Record<string, Record<string, unknown> | undefined> = message as Record<string, Record<string, unknown> | undefined>;

  // Handle LocalDB responses
  if (msg.LocalDBSetKVSuccess) {
    resolveRequest(msg.LocalDBSetKVSuccess.request_id as string, msg.LocalDBSetKVSuccess, state);
  } else if (msg.LocalDBSetKVFailure) {
    rejectRequest(msg.LocalDBSetKVFailure.request_id as string, msg.LocalDBSetKVFailure.message as string, state);
  } else if (msg.LocalDBGetAllKVSuccess) {
    resolveRequest(msg.LocalDBGetAllKVSuccess.request_id as string, msg.LocalDBGetAllKVSuccess, state);
  } else if (msg.LocalDBGetAllKVFailure) {
    rejectRequest(msg.LocalDBGetAllKVFailure.request_id as string, msg.LocalDBGetAllKVFailure.message as string, state);
  } else if (msg.GetSessionsResponse) {
    resolveRequest(msg.GetSessionsResponse.request_id as string, msg.GetSessionsResponse, state);
  } else if (msg.ConnectionManagementSuccess) {
    debugLog('ConnectionService', 'ConnectionManager: Received ConnectionManagementSuccess');
    resolveRequest(msg.ConnectionManagementSuccess.request_id as string, message, state);
  } else if (msg.ConnectionManagementFailure) {
    debugLog('ConnectionService', 'ConnectionManager: Received ConnectionManagementFailure');
    resolveRequest(msg.ConnectionManagementFailure.request_id as string, message, state);
  }

  // Handle successful registration/connection
  const response: Record<string, Record<string, unknown> | undefined> = (msg.Response || msg) as Record<string, Record<string, unknown> | undefined>;
  if (response.RegisterSuccess || response.ConnectSuccess) {
    await handleAuthResponse(response, state, io, onSuccessfulConnection);
  }

  // Handle successful connection management
  const cmSuccess: Record<string, unknown> | undefined = (response.ConnectionManagementSuccess as Record<string, unknown> | undefined);
  if (cmSuccess) {
    await handleConnectionManagementResponse(cmSuccess, state, io, onSuccessfulConnection);
  }

  // Handle disconnect notifications
  //
  // This used to log and invalidate a cache, and change no connection state at
  // all — so a server-side session loss left a fully rendered workspace whose
  // every action then hung or timed out, with no banner, no toast and no
  // redirect. The user could not tell. The teardown below is the same pair
  // already used by the user-initiated path in lifecycle.ts; only the
  // server-initiated path never got it.
  const disconnectNotification: Record<string, unknown> | undefined = (response.DisconnectNotification as Record<string, unknown> | undefined);
  if (disconnectNotification) {
    const notifiedCid: bigint | undefined = disconnectNotification.cid as bigint | undefined;
    const currentCid: bigint | undefined = state.currentConnectionInfo?.cid;
    debugLog('ConnectionService', 'ConnectionManager: Received DisconnectNotification for CID:', notifiedCid);
    state.invalidateCache();

    // Only for the session actually showing. The internal service multiplexes
    // several accounts over one socket, so tearing down on any CID would take
    // another account's UI with it.
    if (notifiedCid !== undefined && currentCid !== undefined && notifiedCid === currentCid) {
      state.setCurrentConnectionInfo(null);
      io.updateConnectionService({ cid: null, isConnected: false });
      io.broadcastConnectionStatus({ isConnected: false });
    }
  }

  // Handle connection failures
  if (response.ConnectFailure) {
    await onConnectFailure(response.ConnectFailure as { message?: string });
  }
}

async function handleAuthResponse(
  response: Record<string, Record<string, unknown> | undefined>,
  state: ConnectionState,
  io: ConnectionIO,
  onSuccessfulConnection: (cid: bigint, shouldUpdate: boolean) => Promise<void>,
): Promise<void> {
  const cid: unknown = (response.RegisterSuccess as Record<string, unknown> | undefined)?.cid
    || (response.ConnectSuccess as Record<string, unknown> | undefined)?.cid;
  const requestId: unknown = (response.RegisterSuccess as Record<string, unknown> | undefined)?.request_id
    || (response.ConnectSuccess as Record<string, unknown> | undefined)?.request_id;
  const cidBigInt: bigint | undefined = cid as bigint | undefined;
  const reqId: string | undefined = requestId as string | undefined;
  debugLog('ConnectionService', `ConnectionManager: Received registration/connection success, CID=${cidBigInt?.toString()}, request_id=${reqId}`);

  const hasPendingRequest: boolean | "" | undefined = reqId && state.hasPendingRequest(reqId);
  const tabSelection: TabSelectionContext | null = await io.getSelectedUser();
  const isOurSession: boolean = Boolean(cidBigInt && tabSelection?.selectedCid === cidBigInt);
  const isFreshTab: boolean = !tabSelection?.selectedCid && !state.currentConnectionInfo;

  if (hasPendingRequest || isOurSession || isFreshTab) {
    debugLog('ConnectionService', `ConnectionManager: Processing connection success (hasPending=${hasPendingRequest}, isOurSession=${isOurSession}, isFreshTab=${isFreshTab})`);
    state.invalidateCache();
    if (cidBigInt) {
      debugLog('ConnectionService', `ConnectionManager: Calling handleSuccessfulConnection for CID=${cidBigInt.toString()}`);
      await onSuccessfulConnection(cidBigInt, false);
    }
  } else {
    debugLog('ConnectionService', `ConnectionManager: Ignoring connection success - not our session (requestId=${reqId}, ourCid=${tabSelection?.selectedCid?.toString()}, currentCid=${state.currentConnectionInfo?.cid?.toString()})`);
  }
}

async function handleConnectionManagementResponse(
  cmSuccess: Record<string, unknown>,
  state: ConnectionState,
  io: ConnectionIO,
  onSuccessfulConnection: (cid: bigint, shouldUpdate: boolean) => Promise<void>,
): Promise<void> {
  const cmReqId: string | undefined = cmSuccess.request_id as string | undefined;
  const cmCid: bigint | undefined = cmSuccess.cid as bigint | undefined;
  debugLog('ConnectionService', 'ConnectionManager: Received ConnectionManagementSuccess, request_id:', cmReqId, 'cid:', cmCid?.toString());

  const hasPendingRequest: boolean = cmReqId !== undefined && state.hasPendingRequest(cmReqId);
  const tabSelection: TabSelectionContext | null = await io.getSelectedUser();
  const isOurSession: boolean = cmCid !== undefined && tabSelection?.selectedCid === cmCid;
  const isFreshTab: boolean = !tabSelection?.selectedCid && !state.currentConnectionInfo;

  if (hasPendingRequest || isOurSession || isFreshTab) {
    debugLog('ConnectionService', 'ConnectionManager: Processing ConnectionManagementSuccess (hasPending:', hasPendingRequest, ', isOurSession:', isOurSession, ', isFreshTab:', isFreshTab, ')');
    state.invalidateCache();
    if (cmCid) {
      debugLog('ConnectionService', 'ConnectionManager: Updating connection info with claimed session CID:', cmCid);
      await onSuccessfulConnection(cmCid, false);
    }
  } else {
    debugLog('ConnectionService', 'ConnectionManager: Ignoring ConnectionManagementSuccess - not our session');
  }
}

export function resolveRequest(requestId: string, data: unknown, state: ConnectionState): void {
  const pending: PendingRequest | undefined = state.getPendingRequest(requestId);
  if (pending) {
    pending.resolve(data);
    state.deletePendingRequest(requestId);
  }
}

export function rejectRequest(requestId: string, message: string, state: ConnectionState): void {
  const pending: PendingRequest | undefined = state.getPendingRequest(requestId);
  if (pending) {
    pending.reject(new Error(message));
    state.deletePendingRequest(requestId);
  }
}
