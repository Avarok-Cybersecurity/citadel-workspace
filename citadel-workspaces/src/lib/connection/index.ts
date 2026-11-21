/**
 * Connection Module
 *
 * Re-exports for backward compatibility.
 *
 * NOTE: Components should import from '@/lib/connection' which resolves to this file.
 */

// Types
export type {
  CurrentConnectionInfo,
  PendingRequest,
  TabSelectionContext,
  AuthSuccessParams,
  SessionClaimResult,
  ConnectionIntent,
  InitWebSocketIntent,
  SetOrphanModeIntent,
  SendWebSocketMessageIntent,
  DisconnectIntent,
  ClaimSessionIntent,
  LocalDBSetIntent,
  LocalDBGetIntent,
  BroadcastConnectionStatusIntent,
  UpdateConnectionServiceIntent,
  SetWorkspaceConnectionIdIntent,
  EmitEventIntent,
  SetInstanceCidIntent,
  AnnouncePresenceIntent,
  WaitForHealthyIntent,
  SetSelectedUserIntent,
  ClearSelectedUserIntent,
} from './types';

// Constants
export {
  CACHE_TTL_MS,
  GET_SESSIONS_TIMEOUT_MS,
  WEBSOCKET_INIT_TIMEOUT_MS,
  SET_USER_TIMEOUT_MS,
} from './constants';

// State Management
export { ConnectionStateCore } from './state-core';
export { ConnectionState } from './state-cache';

// I/O Operations
export { ConnectionIO, connectionIO } from './io';

// Main Service
export { ConnectionManager, connectionManager } from './service';
