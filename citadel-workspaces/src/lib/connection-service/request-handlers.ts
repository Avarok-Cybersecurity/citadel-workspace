/**
 * Connection Service - Request Handlers
 *
 * Logic for sending, accepting, rejecting, and canceling connection requests.
 */

import { v4 as uuidv4 } from 'uuid';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import {
  ConnectionRequest,
  ConnectionRequestStatus,
  ConnectionType
} from './types';

/**
 * Create a new pending connection request.
 */
export function createRequest(
  recipientId: string,
  type: ConnectionType,
  message?: string
): ConnectionRequest {
  const timestamp: number = Date.now();
  return {
    id: uuidv4(),
    requesterId: 'current-user',
    recipientId,
    type,
    status: ConnectionRequestStatus.PENDING,
    message,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/**
 * Find a request in a list, throwing if not found or not pending.
 */
export function findPendingRequest(
  requests: ConnectionRequest[],
  requestId: string
): ConnectionRequest {
  const request: ConnectionRequest | undefined = requests.find(req => req.id === requestId);
  if (!request) {
    throw new Error(`Connection request ${requestId} not found`);
  }
  if (request.status !== ConnectionRequestStatus.PENDING) {
    throw new Error(`Connection request ${requestId} is not pending`);
  }
  return request;
}

/**
 * Send a P2P registration request to another user.
 * Returns the created request. Schedules a simulated response after 1.5s.
 */
export function sendRegistrationRequest(
  requests: ConnectionRequest[],
  recipientId: string,
  message: string,
  onSimulateReceived: (request: ConnectionRequest) => void
): ConnectionRequest {
  const request: ConnectionRequest = createRequest(recipientId, ConnectionType.P2P_REGISTRATION, message);

  debugLog('ConnectionService', `Sending P2P registration request to ${recipientId}`);
  requests.push(request);

  // Simulate a response for demo purposes
  setTimeout(() => {
    onSimulateReceived(request);
  }, 1500);

  return request;
}

/**
 * Initiate a P2P connection request (auto-accepted).
 * Schedules auto-accept after 1s.
 */
export function initiateP2PConnection(
  requests: ConnectionRequest[],
  recipientId: string,
  onAutoAccept: (request: ConnectionRequest) => Promise<void>
): void {
  const request: ConnectionRequest = createRequest(recipientId, ConnectionType.P2P_CONNECTION);

  debugLog('ConnectionService', `Initiating P2P connection with ${recipientId}`);
  requests.push(request);

  // For demo purposes, auto-accept P2P connections
  setTimeout(() => {
    runAsyncSetup(async () => {
      await onAutoAccept(request);
    });
  }, 1000);
}

/**
 * Accept a connection request.
 * Updates status and returns the modified request.
 */
export function markAccepted(request: ConnectionRequest): void {
  request.status = ConnectionRequestStatus.ACCEPTED;
  request.updatedAt = Date.now();
}

/**
 * Reject a connection request.
 */
export function markRejected(request: ConnectionRequest): void {
  request.status = ConnectionRequestStatus.REJECTED;
  request.updatedAt = Date.now();
}

/**
 * Cancel a connection request.
 */
export function markCanceled(request: ConnectionRequest): void {
  request.status = ConnectionRequestStatus.CANCELED;
  request.updatedAt = Date.now();
}
