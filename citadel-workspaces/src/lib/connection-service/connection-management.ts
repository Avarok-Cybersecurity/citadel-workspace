/**
 * Connection Service - Connection Management
 *
 * User connection CRUD, preferences management, and query helpers.
 */

import { debugLog } from '@/lib/debug-config';
import type {
  ConnectionRequest,
  ConnectionRequestStatus,
  UserConnection,
  UserConnectionPreferences
} from './types';

const CURRENT_USER: "current-user" = 'current-user';

const DEFAULT_PREFERENCES: UserConnectionPreferences = {
  autoAcceptRegistrations: false
};

/**
 * Create a new user connection record.
 */
export function createUserConnection(
  userConnections: Map<string, UserConnection[]>,
  userId: string,
  isRegistered: boolean,
  isConnected: boolean
): UserConnection {
  const timestamp: number = Date.now();
  const connection: UserConnection = {
    userId: CURRENT_USER,
    connectedUserId: userId,
    isRegistered,
    isConnected,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const list: UserConnection[] = userConnections.get(CURRENT_USER) || [];
  list.push(connection);
  userConnections.set(CURRENT_USER, list);

  return connection;
}

/**
 * Update an existing user connection record.
 */
export function updateUserConnection(
  userConnections: Map<string, UserConnection[]>,
  userId: string,
  isRegistered?: boolean,
  isConnected?: boolean
): UserConnection | null {
  const list: UserConnection[] = userConnections.get(CURRENT_USER) || [];
  const idx: number = list.findIndex(conn => conn.connectedUserId === userId);
  if (idx === -1) return null;

  const connection: UserConnection = list[idx];
  if (isRegistered !== undefined) connection.isRegistered = isRegistered;
  if (isConnected !== undefined) connection.isConnected = isConnected;
  connection.updatedAt = Date.now();

  list[idx] = connection;
  userConnections.set(CURRENT_USER, list);

  return connection;
}

/**
 * Check if a user can be messaged (requires both registration and connection).
 */
export function canMessageUser(
  userConnections: Map<string, UserConnection[]>,
  userId: string
): boolean {
  const list: UserConnection[] = userConnections.get(CURRENT_USER) || [];
  const connection: UserConnection | undefined = list.find(conn => conn.connectedUserId === userId);
  return connection?.isRegistered === true && connection?.isConnected === true;
}

/**
 * Get all connections for the current user.
 */
export function getUserConnections(
  userConnections: Map<string, UserConnection[]>
): UserConnection[] {
  return userConnections.get(CURRENT_USER) || [];
}

/**
 * Get pending requests targeted at the current user.
 */
export function getPendingRequests(
  requests: ConnectionRequest[],
  status: ConnectionRequestStatus
): ConnectionRequest[] {
  return requests.filter(req =>
    req.recipientId === CURRENT_USER && req.status === status
  );
}

/**
 * Get all requests involving the current user.
 */
export function getAllRequests(requests: ConnectionRequest[]): ConnectionRequest[] {
  return requests.filter(req =>
    req.recipientId === CURRENT_USER || req.requesterId === CURRENT_USER
  );
}

/**
 * Get user preferences, returning defaults if not set.
 */
export function getPreferences(
  prefsMap: Map<string, UserConnectionPreferences>
): UserConnectionPreferences {
  return prefsMap.get(CURRENT_USER) || { ...DEFAULT_PREFERENCES };
}

/**
 * Set user preferences (merges with existing).
 */
export function setPreferences(
  prefsMap: Map<string, UserConnectionPreferences>,
  partial: Partial<UserConnectionPreferences>
): void {
  const current: UserConnectionPreferences = getPreferences(prefsMap);
  prefsMap.set(CURRENT_USER, { ...current, ...partial });
  debugLog('ConnectionService', 'User preferences updated:', prefsMap.get(CURRENT_USER));
}
