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
 * LocalDB key-value pair
 */
export interface LocalDBKVPair {
  key: string;
  value: number[];
}

/**
 * LocalDB request types
 */
export interface LocalDBSetKVRequest {
  cid: bigint;
  peer_cid?: bigint;
  key: string;
  value: number[];
  request_id: string;
}

export interface LocalDBGetKVRequest {
  cid: bigint;
  peer_cid?: bigint;
  key: string;
  request_id: string;
}

export interface LocalDBGetAllKVRequest {
  cid: bigint;
  peer_cid?: bigint;
  request_id: string;
}

/**
 * LocalDB response types
 */
export interface LocalDBSetKVSuccess {
  cid: bigint;
  peer_cid?: bigint;
  key: string;
  request_id: string;
}

export interface LocalDBGetKVSuccess {
  cid: bigint;
  peer_cid?: bigint;
  key: string;
  value: number[];
  request_id: string;
}

export interface LocalDBGetAllKVSuccess {
  cid: bigint;
  peer_cid?: bigint;
  map: Record<string, number[]>;
  request_id: string;
}

/**
 * Key names for LocalDB storage
 */
export const SESSION_STORAGE_KEY: "citadel_sessions" = 'citadel_sessions';
export const ACTIVE_SESSION_KEY: "citadel_active_session" = 'citadel_active_session';

/**
 * Peer connection information within a session
 */
export interface PeerSessionInformation {
  cid: bigint;
  peer_cid: bigint;
  peer_username: string;
}

/**
 * Active session info from internal service
 */
export interface ActiveSession {
  cid: bigint;
  username: string;
  server_address: string;
  /**
   * The address as the user typed it (`acme.work.avarok.net`), from the agent. Behind the
   * Cloudflare edge `server_address` is the RESOLVED address, shared by every hosted
   * workspace, so it cannot say which workspace a session belongs to. Absent from agents
   * older than the field.
   */
  server_host?: string | null;
  full_name?: string;
  /** Peers this session is connected to (peer_cid as string key -> PeerSessionInformation) */
  peer_connections?: Record<string, PeerSessionInformation>;
}

/**
 * GetSessions request to internal service
 */
export interface GetSessionsRequest {
  request_id: string;
}

/**
 * GetSessions' `signed_out` entry: an account whose session the agent removed
 * when its reconnect gave up (the server refused it, stayed unreachable, or held
 * the old session too long). Listed until that account signs in again.
 */
export interface SignedOutAccount {
  cid: bigint;
  username: string;
  /** What the agent's ServerReconnectFailed said. */
  reason: string;
}

/**
 * GetSessions response from internal service
 */
export interface GetSessionsResponse {
  request_id: string;
  sessions: ActiveSession[];
}