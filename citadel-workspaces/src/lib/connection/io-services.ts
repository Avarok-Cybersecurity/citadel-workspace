/**
 * Connection I/O - Service Operations
 *
 * Handles connections to application services: ConnectionService,
 * WorkspaceService, broadcasts, events, instances, health, tab context.
 * Part of the ConnectionIO class (SBIO pattern).
 */

import { ConnectionService } from '../connection-service';
import WorkspaceService from '../workspace-service';
import { broadcastChannelService } from '../broadcast-channel-service';
import { healthCheckService } from '../health-check';
import { eventEmitter } from '../event-emitter';
import { peerRegistrationStore } from '../peer-registration-store';
import { serverAutoConnectService } from '../server-auto-connect-service';
import { instanceManager, instanceChannel } from '../multi-instance';
import { setSelectedUser, getSelectedUser, clearSelectedUser } from '../tab-context';
import type { TabSelectionContext } from './types';
import type { TabUserContext } from '@/lib/tab-context';

/**
 * Service-layer I/O operations.
 * Extracted from ConnectionIO for file size compliance.
 */
export class ConnectionIOServices {
  // ============================================================================
  // Connection Service Operations
  // ============================================================================

  updateConnectionService(status: {
    cid: bigint | null;
    isConnected: boolean;
    userContext?: TabSelectionContext;
  }): void {
    const connectionService: ConnectionService = ConnectionService.getInstance();
    connectionService.updateConnectionStatus(status);
  }

  setWorkspaceConnectionId(cid: bigint): void {
    WorkspaceService.setConnectionId(cid);
  }

  // ============================================================================
  // Broadcast Operations
  // ============================================================================

  broadcastConnectionStatus(status: { isConnected: boolean; cid?: bigint }): void {
    broadcastChannelService.broadcastConnectionStatus(status);
  }

  getIsLeaderFromBroadcast(): boolean {
    return broadcastChannelService.getIsLeader();
  }

  // ============================================================================
  // Event Operations
  // ============================================================================

  emitEvent(event: string, data: unknown): void {
    eventEmitter.emit(event, data);
  }

  onEvent<T>(event: string, handler: (data: T) => void): () => void {
    return eventEmitter.on(event, handler);
  }

  // ============================================================================
  // Instance Management
  // ============================================================================

  setInstanceCid(cid: bigint): void {
    instanceManager.setCid(cid);
  }

  announcePresence(): void {
    instanceChannel.announcePresence();
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  async waitForHealthy(timeoutMs: number): Promise<void> {
    await healthCheckService.waitForHealthy(timeoutMs);
  }

  // ============================================================================
  // Tab Context
  // ============================================================================

  async setSelectedUser(context: TabSelectionContext): Promise<void> {
    await setSelectedUser({
      selectedUsername: context.selectedUsername ?? undefined,
      selectedServerAddress: context.selectedServerAddress ?? undefined,
      selectedCid: context.selectedCid,
    });
  }

  async getSelectedUser(): Promise<TabSelectionContext | null> {
    const result: TabUserContext | null = await getSelectedUser();
    if (!result) return null;
    return {
      selectedUsername: result.selectedUsername ?? null,
      selectedServerAddress: result.selectedServerAddress ?? null,
      selectedCid: result.selectedCid,
    };
  }

  async clearSelectedUser(): Promise<void> {
    await clearSelectedUser();
  }

  // ============================================================================
  // Server Auto Connect
  // ============================================================================

  async initServerAutoConnect(): Promise<void> {
    await serverAutoConnectService.init();
  }

  markUserDisconnectedNow(username: string, serverAddress: string): void {
    serverAutoConnectService.markUserDisconnectedNow(username, serverAddress);
  }

  async persistUserDisconnected(): Promise<void> {
    await serverAutoConnectService.persistUserDisconnected();
  }

  async markUserDisconnected(username: string, serverAddress: string): Promise<void> {
    await serverAutoConnectService.markUserDisconnected(username, serverAddress);
  }

  // ============================================================================
  // Peer Registration Store
  // ============================================================================

  async initPeerRegistrationStore(): Promise<void> {
    await peerRegistrationStore.initialize();
  }
}
