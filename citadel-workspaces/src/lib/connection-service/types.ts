/**
 * Connection Service - Types
 *
 * Enums and interfaces for connection requests, user connections, and preferences.
 */

export enum ConnectionRequestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  CANCELED = 'canceled'
}

export enum ConnectionType {
  P2P_REGISTRATION = 'p2p_registration',  // Requires manual acceptance unless auto-accept is on
  P2P_CONNECTION = 'p2p_connection'       // Auto-accepted by default
}

export interface ConnectionRequest {
  id: string;
  requesterId: string;
  recipientId: string;
  type: ConnectionType;
  status: ConnectionRequestStatus;
  message?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserConnection {
  userId: string;
  connectedUserId: string;
  isRegistered: boolean;   // P2P registration complete
  isConnected: boolean;    // P2P connection complete
  createdAt: number;
  updatedAt: number;
}

export interface UserConnectionPreferences {
  autoAcceptRegistrations: boolean;  // Automatically accept P2P registration requests
}

export interface ConnectionStatus {
  cid: bigint | string | null;
  isConnected: boolean;
  userContext?: { selectedUsername: string | null; selectedServerAddress: string | null; selectedCid?: bigint };
}
