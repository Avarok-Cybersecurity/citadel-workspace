/**
 * Peer Registration Store - Constants
 *
 * Polling intervals, timeouts, and configuration values.
 */

import { TIMEOUT } from '../timeout-constants';

export const STORAGE_KEY: "pending_peer_requests" = 'pending_peer_requests';
export const OUTGOING_STORAGE_KEY: "outgoing_peer_requests" = 'outgoing_peer_requests';
export const REQUEST_TIMEOUT_MS: number = TIMEOUT.LOCALDB_REQUEST_MS;

/** Outgoing request poll loop interval (5 minutes) */
export const OUTGOING_POLL_INTERVAL_MS: number = 5 * 60 * 1000;

/** How long since last send before we resend (matches poll interval) */
export const OUTGOING_RESEND_THRESHOLD_MS: number = 5 * 60 * 1000;
