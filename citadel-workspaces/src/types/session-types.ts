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
   * LEGACY, never written. Builds before passkey unlock stored the account
   * password here in plaintext; every read now removes it (see
   * connection/scrub-legacy-credentials.ts). Still declared so that scrub, and
   * the reconnect paths that refuse a session without one, type-check.
   */
  password?: string;
  serverAddress: string;
  /** LEGACY, never written: the workspace PSK, scrubbed on read like `password`. */
  serverPassword?: string;
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
