/**
 * Connection I/O Router
 *
 * Composes WebSocket and Service I/O operations into a single facade.
 * Follows SBIO principle - all I/O is routed through this class.
 */

import type { StoredSessions, GetSessionsResponse } from '@/types/session-types';
import type { SessionSecuritySettings } from '../p2p-registration-service';
import type { ConnectionIntent, TabSelectionContext, PendingRequest } from './types';
import { ConnectionIOWebSocket } from './io-websocket';
import { ConnectionIOServices } from './io-services';
import type { AccountHost } from '@/lib/admission/account-servers';

export class ConnectionIO {
  private ws: ConnectionIOWebSocket = new ConnectionIOWebSocket();
  private svc: ConnectionIOServices = new ConnectionIOServices();

  async executeIntent(intent: ConnectionIntent): Promise<unknown> {
    // Try WebSocket intents first
    const wsResult: unknown = await this.ws.executeWebSocketIntent(intent);
    if (wsResult !== undefined) return wsResult;

    // Service-layer intents
    switch (intent.type) {
      case 'broadcast-connection-status':
        return this.svc.broadcastConnectionStatus(intent.status);
      case 'update-connection-service':
        return this.svc.updateConnectionService(intent.status);
      case 'set-workspace-connection-id':
        return this.svc.setWorkspaceConnectionId(intent.cid);
      case 'mark-user-disconnected':
        return this.svc.markUserDisconnected(intent.username, intent.serverAddress);
      case 'emit-event':
        return this.svc.emitEvent(intent.event, intent.data);
      case 'set-instance-cid':
        return this.svc.setInstanceCid(intent.cid);
      case 'announce-presence':
        return this.svc.announcePresence();
      case 'wait-for-healthy':
        return this.svc.waitForHealthy(intent.timeoutMs);
      case 'set-selected-user':
        return this.svc.setSelectedUser(intent.context);
      case 'clear-selected-user':
        return this.svc.clearSelectedUser();
      default:
        throw new Error(`Unknown connection intent type: ${(intent as ConnectionIntent).type}`);
    }
  }

  // Delegate WebSocket operations
  async initWebSocket(): Promise<void> { return this.ws.initWebSocket(); }
  setOrphanMode(enabled: boolean): void { this.ws.setOrphanMode(enabled); }
  async sendWebSocketMessage(message: unknown): Promise<void> { return this.ws.sendWebSocketMessage(message); }
  canSendRequests(): boolean { return this.ws.canSendRequests(); }
  async waitForWebSocketInit(): Promise<void> { return this.ws.waitForWebSocketInit(); }
  async connect(params: { requestId: string; username: string; serverAddress: string; password: string; sessionSecuritySettings?: SessionSecuritySettings }): Promise<void> { return this.ws.connect(params); }
  async disconnect(cid: bigint): Promise<void> { return this.ws.disconnect(cid); }
  /** The agent's accounts with the server each is on (GetAccountInformation); loaded when asked. */
  async agentAccounts(): Promise<AccountHost[]> {
    const [{ askStoredAccounts }, { readAccountHosts }] = await Promise.all([import('@/lib/stored-accounts'), import('@/lib/admission/account-servers')]);
    return askStoredAccounts(readAccountHosts);
  }
  // Loaded on sign-out only: the landing page's critical path does not carry it.
  async forgetAccountDocuments(cid: bigint): Promise<void> { return (await import('@/lib/document-replica-cache')).forgetAccountDocuments(cid); }
  async forgetAtRestRoot(cid: bigint): Promise<void> { return (await import('@/lib/document-replica-cache')).forgetAtRestRoot(cid); }
  async claimSession(cid: bigint, onlyIfOrphaned: boolean): Promise<unknown> { return this.ws.claimSession(cid, onlyIfOrphaned); }
  async localDBSet(cid: bigint, key: string, value: number[]): Promise<void> { return this.ws.localDBSet(cid, key, value); }
  async localDBGet(cid: bigint, key: string): Promise<{ value: number[] } | null> { return this.ws.localDBGet(cid, key); }
  async storeSessionsToLocalDB(sessions: StoredSessions): Promise<void> { return this.ws.storeSessionsToLocalDB(sessions); }
  async loadSessionsFromLocalDB(): Promise<StoredSessions | null> { return this.ws.loadSessionsFromLocalDB(); }
  async sendGetSessionsRequest(requestId: string, pendingRequests: Map<string, PendingRequest>, timeoutMs: number): Promise<GetSessionsResponse> { return this.ws.sendGetSessionsRequest(requestId, pendingRequests, timeoutMs); }

  // Delegate service operations
  updateConnectionService(status: { cid: bigint | null; isConnected: boolean; userContext?: TabSelectionContext }): void { this.svc.updateConnectionService(status); }
  setWorkspaceConnectionId(cid: bigint): void { this.svc.setWorkspaceConnectionId(cid); }
  broadcastConnectionStatus(status: { isConnected: boolean; cid?: bigint }): void { this.svc.broadcastConnectionStatus(status); }
  getIsLeaderFromBroadcast(): boolean { return this.svc.getIsLeaderFromBroadcast(); }
  emitEvent(event: string, data: unknown): void { this.svc.emitEvent(event, data); }
  onEvent<T>(event: string, handler: (data: T) => void): () => void { return this.svc.onEvent(event, handler); }
  setInstanceCid(cid: bigint): void { this.svc.setInstanceCid(cid); }
  announcePresence(): void { this.svc.announcePresence(); }
  async waitForHealthy(timeoutMs: number): Promise<void> { return this.svc.waitForHealthy(timeoutMs); }
  async setSelectedUser(context: TabSelectionContext): Promise<void> { return this.svc.setSelectedUser(context); }
  async getSelectedUser(): Promise<TabSelectionContext | null> { return this.svc.getSelectedUser(); }
  async clearSelectedUser(): Promise<void> { return this.svc.clearSelectedUser(); }
  async initServerAutoConnect(): Promise<void> { return this.svc.initServerAutoConnect(); }
  async markUserDisconnected(username: string, serverAddress: string): Promise<void> { return this.svc.markUserDisconnected(username, serverAddress); }
  markUserDisconnectedNow(username: string, serverAddress: string): void { this.svc.markUserDisconnectedNow(username, serverAddress); }
  async persistUserDisconnected(): Promise<void> { return this.svc.persistUserDisconnected(); }
  async initPeerRegistrationStore(): Promise<void> { return this.svc.initPeerRegistrationStore(); }
}

// Export singleton instance
export const connectionIO: ConnectionIO = new ConnectionIO();
