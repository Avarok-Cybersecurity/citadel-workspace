/**
 * Session types for managing persistent connections
 */

import { SessionSecuritySettings } from "@/lib/p2p-registration-service";

/**
 * Represents a stored session for auto-reconnection
 */
export interface StoredSession {
  username: string;
  /**
   * Never written: a password kept for next time is sealed under the user's passkey
   * (src/lib/passkey), not stored here. Read only by the background reconnect paths
   * (connection/lifecycle.ts, connection/reconnect.ts, server-auto-connect-service), which are
   * therefore inert and are listed for removal.
   */
  password?: string;
  serverAddress: string;
  fullName: string;
  lastConnected: number;
  cid?: bigint; // Store the CID for claiming orphaned sessions
  /** The role's name in the workspace's table, for the workspace switcher. Display only. */
  role?: string;
  /** Known to hold ManageRoles there: the switcher's administrator shield. */
  administers?: boolean;
  sessionSecuritySettings: SessionSecuritySettings
}

/**
 * Collection of stored sessions
 */
export interface StoredSessions {
  sessions: StoredSession[];
  activeSessionIndex?: number;
}

/**
 * Connection info returned after successful connection
 */
export interface ConnectionInfo {
  cid: bigint;
  username: string;
  serverAddress: string;
  fullName: string;
}

/**
 * Key names for LocalDB storage
 */
export const SESSION_STORAGE_KEY: "citadel_sessions" = 'citadel_sessions';
export const ACTIVE_SESSION_KEY: "citadel_active_session" = 'citadel_active_session';
