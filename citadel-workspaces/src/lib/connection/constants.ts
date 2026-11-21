/**
 * Connection Manager Constants
 *
 * Configuration constants for connection management.
 * References shared timeout-constants.ts where values overlap.
 */

import { TIMEOUT, INTERVAL } from '../timeout-constants';

/**
 * Cache TTL for active sessions (milliseconds).
 * Prevents excessive GetSessions requests.
 */
export const CACHE_TTL_MS: number = INTERVAL.HEARTBEAT_MS;

/**
 * Timeout for GetSessions request (milliseconds).
 */
export const GET_SESSIONS_TIMEOUT_MS: number = TIMEOUT.CLAIM_SESSION_MS;

/**
 * Timeout for WebSocket initialization during startup (milliseconds).
 */
export const WEBSOCKET_INIT_TIMEOUT_MS: number = TIMEOUT.SESSION_MANAGEMENT_MS;

/**
 * Timeout for setSelectedUser operation (milliseconds).
 */
export const SET_USER_TIMEOUT_MS: number = TIMEOUT.SESSION_MANAGEMENT_MS;

/**
 * Reaching the agent at page start: attempts, and the backoff between them
 * (1s, 2s, 4s, 8s, 8s). One failed WebSocket during start-up used to be final
 * -- the page never retried and hung on "taking longer than expected".
 */
export const AGENT_START_RETRY: { readonly maxAttempts: number; readonly baseDelayMs: number; readonly maxDelayMs: number } = {
  maxAttempts: 6,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};
