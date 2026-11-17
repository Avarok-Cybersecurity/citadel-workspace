/**
 * Server Auto-Connect Service - Types
 *
 * Interfaces and constants for session reconnection management.
 */

import { TIMEOUT, POLLING } from '@/lib/timeout-constants';

export interface ConnectionAttempt {
  sessionKey: string;
  attempts: number;
  timeout: NodeJS.Timeout | null;
  lastError?: string;
}

export const BASE_DELAY: number = TIMEOUT.SERVER_REQUEST_MS;
export const MAX_DELAY: number = POLLING.OUTGOING_REQUESTS_INTERVAL_MS;
export const POLL_INTERVAL_MS: number = POLLING.SERVER_POLL_INTERVAL_MS;
export const LOCALDB_KEY: "server_auto_connect_enabled" = 'server_auto_connect_enabled';
export const USER_DISCONNECTED_KEY: "user_disconnected_sessions" = 'user_disconnected_sessions';
export const GLOBAL_CID: bigint = 0n;
