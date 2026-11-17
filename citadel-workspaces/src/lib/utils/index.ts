/**
 * Utilities Module
 *
 * Centralized utilities for the Citadel Workspaces application.
 */

// CID utilities
export {
  ensureBigInt,
  ensureBigIntOrNull,
  ensureBigIntPair,
  cidToString,
  cidKey,
  cidPairKey,
  isCidLike,
  toCidKey,
  tryParseCid,
  type CidLike
} from './cid-utils';

// Retry utilities
export {
  retryWithBackoff,
  calculateBackoffDelay,
  RetryScheduler,
  sleep,
  createDeferred,
  type RetryOptions
} from './retry-utils';

// Event listener management
export { EventListenerManager } from './event-listener-manager';

// Polling service base classes
export {
  PollingService,
  EventListenerPollingService
} from './polling-service';

// Encoding utilities
export {
  stringToBytes,
  bytesToString
} from './encoding-utils';
