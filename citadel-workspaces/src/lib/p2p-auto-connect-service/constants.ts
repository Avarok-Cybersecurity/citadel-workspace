/**
 * P2P Auto-Connect Service Constants
 *
 * Timeouts, retry configuration, and polling intervals for the service.
 */

/** Base delay for exponential backoff (1 second) */
export const BASE_DELAY_MS: number = 1000;

/** Maximum delay cap for exponential backoff (30 seconds) */
export const MAX_DELAY_MS: number = 30 * 1000;

/** Continuous polling interval after max backoff reached (30 seconds) */
export const POLL_INTERVAL_MS: number = 30 * 1000;

/** Online status cache TTL to avoid redundant API calls (10 seconds) */
export const ONLINE_STATUS_CACHE_TTL_MS: number = 10 * 1000;

/** Timeout for getCurrentCid IndexedDB reads (500ms) */
export const CID_LOOKUP_TIMEOUT_MS: number = 500;

/** Interval for waitForPeerConnected polling (500ms) */
export const PEER_CONNECTED_CHECK_INTERVAL_MS: number = 500;

/** Default timeout for waitForPeerConnected (30 seconds) */
export const WAIT_FOR_PEER_TIMEOUT_MS: number = 30_000;

/** Extra time beyond timeout before cleaning up event listeners (1 second) */
export const LISTENER_CLEANUP_BUFFER_MS: number = 1000;
