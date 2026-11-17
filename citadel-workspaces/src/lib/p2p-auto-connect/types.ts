/**
 * P2P Auto-Connect Types
 *
 * Type definitions for P2P auto-connect functionality.
 */

import type { PeerPathReport } from '@/types/ice-servers';

export interface ConnectionAttempt {
  attempts: number;
  timeout: NodeJS.Timeout | null;
}

/**
 * Information about a connected peer.
 * Stored in the nested Map structure for the single source of truth.
 */
/**
 * `peerUsername` used to live here and nothing ever read it. Three paths wrote
 * it: polling supplied a real name from the peer registry, while the
 * PeerConnectNotification and PeerConnectSuccess handlers read `peer_username`
 * off messages that do not declare it — the generated bindings are
 * `{ cid, peer_cid, ... }` with no username — and passed `''`. Since this
 * record is replaced wholesale on every write, a connect event erased the name
 * polling had learned.
 *
 * It was a second authority for a peer's name that no reader consulted. The
 * name has one home — the conversation and the peer registry, reached through
 * `peerDisplayName` — so this now holds only what it is actually asked for.
 */
export interface PeerConnectionInfo {
  peerCid: bigint;
  connectedAt: number;
  lastVerified: number;
  /**
   * The agent's latest report of how traffic reaches the peer; null until one
   * arrives. PeerConnectSuccess gives the first (normally the server relay) and
   * each PeerPathChangedNotification replaces it.
   */
  route: PeerPathReport | null;
}

/**
 * Configuration for connection retry backoff.
 */
export interface BackoffConfig {
  baseDelay: number;
  maxDelay: number;
  pollInterval: number;
}

/**
 * Default backoff configuration.
 */
// The VALUES live in p2p-auto-connect-service/constants.ts, which is what the
// consumers actually import. They were declared in both places, and the copy
// carrying the "(SSOT)" label in the re-export next door was the one nobody
// read — so tuning it changed nothing. Derived here so the two cannot part.
import {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  POLL_INTERVAL_MS,
  ONLINE_STATUS_CACHE_TTL_MS as SERVICE_ONLINE_STATUS_CACHE_TTL_MS,
} from '../p2p-auto-connect-service/constants';

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelay: BASE_DELAY_MS,
  maxDelay: MAX_DELAY_MS,
  pollInterval: POLL_INTERVAL_MS,
};

export const ONLINE_STATUS_CACHE_TTL_MS: number = SERVICE_ONLINE_STATUS_CACHE_TTL_MS;

/** Fresh connection threshold for race condition prevention. */
export const FRESH_CONNECTION_THRESHOLD_MS: number = 5000;
