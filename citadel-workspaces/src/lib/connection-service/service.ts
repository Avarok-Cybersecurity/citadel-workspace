/**
 * Connection Service - Service Class
 *
 * Singleton orchestrator for connection requests, user connections,
 * preferences, and event-driven lifecycle.
 */

import NotificationService from '@/lib/notification-service';
import { eventEmitter } from '@/lib/event-emitter';
import { debugLog } from '@/lib/debug-config';
import type {
  ConnectionRequest,
  ConnectionStatus,
  UserConnection,
  UserConnectionPreferences,
} from './types';
import {
  ConnectionRequestStatus,
  ConnectionType,
} from './types';
import {
  sendRegistrationRequest,
  findPendingRequest,
  initiateP2PConnection,
  markAccepted,
  markRejected,
  markCanceled,
} from './request-handlers';
import {
  createUserConnection,
  updateUserConnection,
  canMessageUser,
  getUserConnections,
  getPendingRequests,
  getAllRequests,
  getPreferences,
  setPreferences,
} from './connection-management';
import {
  simulateRequestReceived as doSimulateRequestReceived,
  autoAcceptConnection as doAutoAcceptConnection,
} from './demo-simulation';

export class ConnectionService {
  private static instance: ConnectionService;
  private notificationService: NotificationService;
  private connectionRequests: ConnectionRequest[] = [];
  private userConnections: Map<string, UserConnection[]> = new Map();
  private userPreferences: Map<string, UserConnectionPreferences> = new Map();
  private onConnectionRequestStatusChange: ((request: ConnectionRequest) => void) | null = null;
  private onNewConnectionRequest: ((request: ConnectionRequest) => void) | null = null;
  private connectionChangeHandlers: Array<(connection: ConnectionStatus) => void> = [];
  private currentConnection: ConnectionStatus | null = null;

  private constructor() {
    this.notificationService = NotificationService.getInstance();
    this.userPreferences.set('current-user', { autoAcceptRegistrations: false });
    this.setupEventListeners();
  }

  public static getInstance(): ConnectionService {
    if (!ConnectionService.instance) {
      ConnectionService.instance = new ConnectionService();
    }
    return ConnectionService.instance;
  }

  private setupEventListeners(): void {
    debugLog('ConnectionService', 'Setting up connection service event listeners');
    eventEmitter.on('broadcast-connection-status', (status: { isConnected: boolean; cid?: string }) => {
      debugLog('ConnectionService', 'Received broadcast connection status', status);
      this.updateConnectionStatus({ cid: status.cid || null, isConnected: status.isConnected });
    });
  }

  public async sendRegistrationRequest(
    recipientId: string,
    message: string = "I'd like to connect with you"
  ): Promise<ConnectionRequest> {
    try {
      return sendRegistrationRequest(
        this.connectionRequests, recipientId, message,
        (req) => this.simulateRequestReceived(req)
      );
    } catch (error) {
      debugLog('ConnectionService', 'Failed to send registration request:', error);
      throw error;
    }
  }

  private async initiateP2PConnection(recipientId: string): Promise<void> {
    try {
      initiateP2PConnection(
        this.connectionRequests, recipientId,
        (req) => doAutoAcceptConnection(req, this.notificationService, (id) => this.acceptConnectionRequest(id))
      );
    } catch (error) {
      debugLog('ConnectionService', 'Failed to initiate P2P connection:', error);
      throw error;
    }
  }

  public async acceptConnectionRequest(requestId: string): Promise<void> {
    const request: ConnectionRequest = findPendingRequest(this.connectionRequests, requestId);
    try {
      debugLog('ConnectionService', `Accepting connection request ${requestId}`);
      markAccepted(request);
      if (request.type === ConnectionType.P2P_REGISTRATION) {
        createUserConnection(this.userConnections, request.requesterId, true, false);
        await this.initiateP2PConnection(request.requesterId);
      } else if (request.type === ConnectionType.P2P_CONNECTION) {
        updateUserConnection(this.userConnections, request.requesterId, true, true);
      }
      this.onConnectionRequestStatusChange?.(request);
    } catch (error) {
      debugLog('ConnectionService', 'Failed to accept connection request:', error);
      throw error;
    }
  }

  public async rejectConnectionRequest(requestId: string): Promise<void> {
    const request: ConnectionRequest = findPendingRequest(this.connectionRequests, requestId);
    try {
      debugLog('ConnectionService', `Rejecting connection request ${requestId}`);
      markRejected(request);
      this.onConnectionRequestStatusChange?.(request);
    } catch (error) {
      debugLog('ConnectionService', 'Failed to reject connection request:', error);
      throw error;
    }
  }

  public async cancelConnectionRequest(requestId: string): Promise<void> {
    const request: ConnectionRequest = findPendingRequest(this.connectionRequests, requestId);
    try {
      debugLog('ConnectionService', `Canceling connection request ${requestId}`);
      markCanceled(request);
      this.onConnectionRequestStatusChange?.(request);
    } catch (error) {
      debugLog('ConnectionService', 'Failed to cancel connection request:', error);
      throw error;
    }
  }

  public canMessageUser(userId: string): boolean {
    return canMessageUser(this.userConnections, userId);
  }

  public getPendingRequests(): ConnectionRequest[] {
    return getPendingRequests(this.connectionRequests, ConnectionRequestStatus.PENDING);
  }

  public getAllRequests(): ConnectionRequest[] {
    return getAllRequests(this.connectionRequests);
  }

  public getUserConnections(): UserConnection[] {
    return getUserConnections(this.userConnections);
  }

  public setUserPreferences(preferences: Partial<UserConnectionPreferences>): void {
    setPreferences(this.userPreferences, preferences);
  }

  public getUserPreferences(): UserConnectionPreferences {
    return getPreferences(this.userPreferences);
  }

  public getAutoAcceptRegistrations(): boolean {
    return this.getUserPreferences().autoAcceptRegistrations;
  }

  public setAutoAcceptRegistrations(autoAccept: boolean): void {
    this.setUserPreferences({ autoAcceptRegistrations: autoAccept });
  }

  public setConnectionStatusChangeHandler(handler: (request: ConnectionRequest) => void): void {
    this.onConnectionRequestStatusChange = handler;
  }

  public setNewConnectionRequestHandler(handler: (request: ConnectionRequest) => void): void {
    this.onNewConnectionRequest = handler;
  }

  /**
   * Subscribe to connection changes. Returns an unsubscribe function.
   *
   * This used to return void, so every caller's listener stayed registered for
   * the lifetime of the app. Two of the three subscribers re-run their effect on
   * state changes and on remount (AppLayout remounts per route), so the handler
   * array grew without bound: every connection change then ran a pile of dead
   * handlers, each doing IndexedDB reads, and each retaining its dead component's
   * closure. `P2PMessengerManager.onConnectionChange` has always returned an
   * unsubscribe; this one never got it.
   */
  public onConnectionChange(handler: (connection: ConnectionStatus) => void): () => void {
    this.connectionChangeHandlers.push(handler);
    if (this.currentConnection) handler(this.currentConnection);
    return () => {
      this.connectionChangeHandlers = this.connectionChangeHandlers.filter(h => h !== handler);
    };
  }

  public updateConnectionStatus(connection: ConnectionStatus): void {
    debugLog('ConnectionService', `updateConnectionStatus: cid=${connection?.cid?.toString()}, isConnected=${connection?.isConnected}, handlers=${this.connectionChangeHandlers.length}`);
    this.currentConnection = connection;
    for (const handler of this.connectionChangeHandlers) {
      try {
        debugLog('ConnectionService', 'Calling handler');
        handler(connection);
      } catch (error) {
        debugLog('ConnectionService', 'Error in connection change handler:', error);
      }
    }
  }

  public cleanup(): void {
    this.onConnectionRequestStatusChange = null;
    this.onNewConnectionRequest = null;
    this.connectionChangeHandlers = [];
  }

  public simulateRequestReceived(request: ConnectionRequest): void {
    doSimulateRequestReceived(
      request, this.notificationService, this.getUserPreferences(),
      (id) => this.acceptConnectionRequest(id),
      (id) => this.rejectConnectionRequest(id),
      this.onNewConnectionRequest
    );
  }
}
