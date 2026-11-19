/**
 * P2P Registration Service - Constants & Adapters
 *
 * Configuration values, LocalDB keys, and type adapter functions.
 */

import { TIMEOUT, POLLING } from '../timeout-constants';

/** LocalDB key for auto-accept setting */
export const AUTO_ACCEPT_KEY: "p2p_auto_accept_registrations" = 'p2p_auto_accept_registrations';

/** Default polling interval (30 seconds) */
export const POLLING_INTERVAL: number = POLLING.P2P_REGISTRATION_INTERVAL_MS;

/**
 * Timeout for peer listing operations.
 *
 * Must be longer than the AGENT's PEER_LIST_TIMEOUT, which is 30s. This comment
 * used to say 5s — a statement about a Rust constant that had since changed,
 * which is why the value beneath it (6s) had been below the real bound for as
 * long as it had been wrong. See check-peer-list-timeout-parity.
 */
export const PEER_LIST_TIMEOUT: number = TIMEOUT.PEER_LIST_MS;

/** Max concurrent peer registrations in a batch */
export const CONCURRENT_REGISTRATIONS: number = 5;

/** Fixed backoff between retries (ms) */
export const RETRY_BACKOFF_MS: number = 500;

/** Default retry count for listRegisteredPeers */
export const DEFAULT_LIST_RETRIES: number = 2;

/** Timeout for PeerRegister request (ms) */
export const PEER_REGISTER_TIMEOUT_MS: number = 10000;

/** Timeout for CID resolution via IndexedDB (ms) */
export const CID_RESOLUTION_TIMEOUT_MS: number = 500;
