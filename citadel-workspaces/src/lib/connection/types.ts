/**
 * Connection Manager Types
 *
 * Type definitions for connection manager functionality.
 * Follows SBIO principle - types are separate from I/O.
 */

import type { SessionSecuritySettings } from '../p2p-registration-service';

/**
 * Current connection info including CID and user details.
 */
export interface CurrentConnectionInfo {
  cid: bigint;
  username?: string;
  serverAddress?: string;
  fullName?: string;
}

/**
 * Pending request tracking for promise resolution.
 */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Tab selection context for multi-tab support.
 */
export interface TabSelectionContext {
  selectedUsername: string | null;
  selectedServerAddress: string | null;
  selectedCid?: bigint;
}

/**
 * Authentication success parameters.
 */
export interface AuthSuccessParams {
  username: string;
  // No password and no server PSK: neither is kept after authentication, so
  // neither is handed to the code that records the session.
  fullName: string;
  serverAddress: string;
  securitySettings: SessionSecuritySettings;
  cid?: bigint;
}

/**
 * Session claim result.
 */
export interface SessionClaimResult {
  success: boolean;
  cid: bigint;
}

// ============================================================================
// Intent Types for SBIO Pattern
// ============================================================================

export type ConnectionIntent =
  | InitWebSocketIntent
  | SetOrphanModeIntent
  | SendWebSocketMessageIntent
  | ConnectIntent
  | DisconnectIntent
  | ClaimSessionIntent
  | LocalDBSetIntent
  | LocalDBGetIntent
  | BroadcastConnectionStatusIntent
  | UpdateConnectionServiceIntent
  | SetWorkspaceConnectionIdIntent
  | MarkUserDisconnectedIntent
  | EmitEventIntent
  | SetInstanceCidIntent
  | AnnouncePresenceIntent
  | WaitForHealthyIntent
  | SetSelectedUserIntent
  | ClearSelectedUserIntent;

export interface InitWebSocketIntent {
  type: 'init-websocket';
}

export interface SetOrphanModeIntent {
  type: 'set-orphan-mode';
  enabled: boolean;
}

export interface SendWebSocketMessageIntent {
  type: 'send-websocket-message';
  message: unknown;
}

export interface ConnectIntent {
  type: 'connect';
  requestId: string;
  username: string;
  password: string;
  serverAddress: string;
  serverPassword: string;
  sessionSecuritySettings?: SessionSecuritySettings;
}

export interface DisconnectIntent {
  type: 'disconnect';
  cid: bigint;
}

export interface ClaimSessionIntent {
  type: 'claim-session';
  cid: bigint;
  onlyIfOrphaned: boolean;
}

export interface LocalDBSetIntent {
  type: 'localdb-set';
  cid: bigint;
  key: string;
  value: number[];
}

export interface LocalDBGetIntent {
  type: 'localdb-get';
  cid: bigint;
  key: string;
}

export interface BroadcastConnectionStatusIntent {
  type: 'broadcast-connection-status';
  status: { isConnected: boolean; cid?: bigint };
}

export interface UpdateConnectionServiceIntent {
  type: 'update-connection-service';
  status: {
    cid: bigint | null;
    isConnected: boolean;
    userContext?: TabSelectionContext;
  };
}

export interface SetWorkspaceConnectionIdIntent {
  type: 'set-workspace-connection-id';
  cid: bigint;
}

export interface MarkUserDisconnectedIntent {
  type: 'mark-user-disconnected';
  username: string;
  serverAddress: string;
}

export interface EmitEventIntent {
  type: 'emit-event';
  event: string;
  data: unknown;
}

export interface SetInstanceCidIntent {
  type: 'set-instance-cid';
  cid: bigint;
}

export interface AnnouncePresenceIntent {
  type: 'announce-presence';
}

export interface WaitForHealthyIntent {
  type: 'wait-for-healthy';
  timeoutMs: number;
}

export interface SetSelectedUserIntent {
  type: 'set-selected-user';
  context: TabSelectionContext;
}

export interface ClearSelectedUserIntent {
  type: 'clear-selected-user';
}
