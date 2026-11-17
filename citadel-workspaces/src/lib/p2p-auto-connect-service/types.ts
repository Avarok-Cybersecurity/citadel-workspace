/**
 * P2P Auto-Connect Service Types
 *
 * All interfaces, type aliases, and config types for the auto-connect service.
 * Re-exports shared types from p2p-auto-connect module for convenience.
 */

// Re-export shared types from the p2p-auto-connect module.
//
// The "(SSOT)" this comment used to claim was not true of the VALUES below:
// they were declared in both p2p-auto-connect/types.ts and this directory's
// constants.ts, and every consumer imported the latter. The values are now
// derived from constants.ts, which is the copy that was always in force.
export type {
  ConnectionAttempt,
  PeerConnectionInfo,
  BackoffConfig,
} from '../p2p-auto-connect/types';

export {
  DEFAULT_BACKOFF_CONFIG,
  ONLINE_STATUS_CACHE_TTL_MS,
  FRESH_CONNECTION_THRESHOLD_MS,
} from '../p2p-auto-connect/types';
