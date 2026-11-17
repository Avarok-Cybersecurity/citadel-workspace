/**
 * Peer Registration Store - Types
 *
 * All interfaces, type aliases, and helper functions for the peer registration store.
 */


/**
 * Incoming peer registration request - received from another peer
 */
export interface PendingPeerRequest {
  id: string;              // UUID for this request
  peer_cid: bigint;        // CID of the requesting peer
  peer_username: string;   // Username of the requesting peer
  timestamp: number;       // When request was received
  cid: bigint;             // Recipient's CID (our CID)
}

/**
 * Outgoing peer registration request - tracks requests we've sent
 * that are awaiting response (peer may be offline for hours/days)
 */
export interface OutgoingPeerRequest {
  id: string;              // UUID for this request (matches request_id sent to server)
  fromCid: bigint;         // Our CID (the requester)
  toCid: bigint;           // Target peer's CID
  peerUsername: string;    // Target peer's username (for display)
  timestamp: number;       // When request was originally sent
  timeLastSent: number;    // When request was last (re)sent - for poll loop
}

/**
 * Entry in the pending KV request map for correlating LocalDB responses
 */
export interface KVPendingEntry {
  resolve: (value?: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Notification data for incoming peer registration
 */
export interface PeerRegisterNotification {
  cid: bigint;
  peer_cid: bigint;
  peer_username?: string;
}

// One implementation, in lib/wasm-request: this cast is where the app crosses
// into the WASM nominal types, and a grep for it should find every crossing.
export { toInternalServiceRequest } from '@/lib/wasm-request';
