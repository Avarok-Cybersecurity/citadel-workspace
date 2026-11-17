/**
 * Peer Registration Store Module
 *
 * Re-exports all public APIs for backward compatibility.
 * Consumers should import from '@/lib/peer-registration-store'.
 */

// Types
export type {
  PendingPeerRequest,
  OutgoingPeerRequest,
  KVPendingEntry,
  PeerRegisterNotification,
} from './types';
export { toInternalServiceRequest } from './types';

// Constants
export {
  STORAGE_KEY,
  OUTGOING_STORAGE_KEY,
  REQUEST_TIMEOUT_MS,
  OUTGOING_POLL_INTERVAL_MS,
  OUTGOING_RESEND_THRESHOLD_MS,
} from './constants';

// Main Service (singleton + class)
export { peerRegistrationStore, PeerRegistrationStore } from './service';
