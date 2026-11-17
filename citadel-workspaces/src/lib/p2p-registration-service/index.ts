/**
 * P2P Registration Service - Barrel Export
 *
 * Re-exports ALL public exports from the module for backward compatibility.
 * Consumers import from '@/lib/p2p-registration-service' (resolves to this file).
 */

// Types
export type {
  Peer,
  PeerInfoResponse,
  PeerRegistrationOptions,
  PendingRequestEntry,
  SessionSecuritySettings,
  HeaderObfuscatorSettings,
} from './types';

// Constants & adapters
export {
  AUTO_ACCEPT_KEY,
  POLLING_INTERVAL,
  PEER_LIST_TIMEOUT,
  CONCURRENT_REGISTRATIONS,
  RETRY_BACKOFF_MS,
  DEFAULT_LIST_RETRIES,
  PEER_REGISTER_TIMEOUT_MS,
  CID_RESOLUTION_TIMEOUT_MS,
  toGeneratedSecuritySettings,
} from './constants';

// Discovery functions
export {
  getCurrentCid,
  listAllPeers,
  listRegisteredPeers,
  updatePeerMaps,
} from './discovery';

// Registration functions
export type { RegistrationContext } from './registration';
export {
  handleWebSocketMessage,
  registerPeer,
  registerUnregisteredPeers,
} from './registration';

// Connection lifecycle functions
export {
  listRegisteredPeersWithRetry,
  syncPeerConnectionsFromSession,
  getAutoAcceptSetting,
  setAutoAcceptSetting,
  acceptRegistrationRequest,
  declineRegistrationRequest,
} from './connection';
export { handleIncomingRegistrationWithCid } from './incoming-registration';

// Main service class & singleton
export { P2PRegistrationService } from './service';

import { P2PRegistrationService } from './service';

/** Singleton instance */
export const p2pRegistrationService: P2PRegistrationService = P2PRegistrationService.getInstance();
