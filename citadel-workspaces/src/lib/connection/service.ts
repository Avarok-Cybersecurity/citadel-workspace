/** Connection Manager Service - thin orchestrator delegating to specialized modules. */

import { ConnectionState } from './state';
import { ConnectionIO, connectionIO } from './io';
import type { CurrentConnectionInfo, AuthSuccessParams } from './types';
import type { StoredSession, ActiveSession, StoredSessions } from '@/types/session-types';
import { POST_DISCONNECT_DELAY_MS, AGENT_START_RETRY } from './constants';
import { retryWithBackoff } from '@/lib/utils/retry-utils';
import { debugLog } from '@/lib/debug-config';
import { narrowWebSocketMessage } from '@/lib/ws-message-boundary';
import { handleWebSocketMessage } from './message-handling';
import {
  storeSession, loadStoredSessions, handleAuthSuccess,
  handleLogout, updateSessionRole, setActiveSessionIndex,
} from './session-management';
import { removeSession, removeAllSessions, clearStoredSessions } from './session-list';
import { handleSuccessfulConnection, disconnectSession, switchAccount } from './lifecycle';
import { attemptLeaderConnection, autoReconnect } from './reconnect';
import { getActiveSessions, getActiveSessionsResult, type ActiveSessionsResult, handleConnectFailure } from './queries';
import { tabSelectedSession } from './tab-session';
import type { WebSocketMessage } from '@/types/ws-message-types';

export class ConnectionManager {
  private static instance: ConnectionManager;
  private state: ConnectionState;
  private io: ConnectionIO;

  private constructor() {
    this.io = connectionIO;
    this.state = new ConnectionState((): boolean => this.io.getIsLeaderFromBroadcast());
    this.setupEventListeners();
    this.setupLeaderElection();
  }

  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  public async initialize(): Promise<void> {
    if (this.state.isInitialized) {
      debugLog('ConnectionService', 'ConnectionManager already initialized');
      return;
    }

    try {
      debugLog('ConnectionService', 'ConnectionManager: Initializing...');
      await retryWithBackoff(() => this.io.initWebSocket(), { ...AGENT_START_RETRY, onRetry: () => this.io.emitEvent('connection:start-retrying', {}) });

      debugLog('ConnectionService', 'ConnectionManager: Enabling orphan mode (non-blocking)...');
      this.io.setOrphanMode(true);

      await Promise.all([
        this.getActiveSessions().catch(() => []),
        loadStoredSessions(this.state, this.io),
        this.io.initPeerRegistrationStore().catch((error) => {
          debugLog('ConnectionService', 'Failed to initialize peer registration store', error);
        }),
      ]);

      this.state.setInitialized(true);
      debugLog('ConnectionService', 'ConnectionManager: Initialized successfully');

      this.io.initServerAutoConnect().catch((error) => {
        debugLog('ConnectionService', 'Failed to initialize server auto-connect service:', error);
      });

      this.state.resolveReady();
    } catch (error) {
      debugLog('ConnectionService', 'Initialization failed', error);
      this.state.resolveReady();
      throw error;
    }
  }

  public async waitForReady(): Promise<void> { if (!this.state.isInitialized) await this.state.readyPromise; }
  /** Whether initialization succeeded; after waitForReady, false means it failed. */
  public get initialized(): boolean { return this.state.isInitialized; }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  private setupEventListeners(): void {
    this.state.executeCleanup();

    const onMessage = async (raw: unknown): Promise<void> => {
      const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
      if (!message) return;
      await handleWebSocketMessage(
        message, this.state, this.io,
        (cid, update) => handleSuccessfulConnection(cid, update, this.state, this.io),
        (failure) => handleConnectFailure(failure, this.state, this.io, () => this.getActiveSessions()),
      );
    };

    this.state.addCleanupFunction(this.io.onEvent('websocket-message', onMessage));
    this.state.addCleanupFunction(this.io.onEvent('broadcast-workspace-response', onMessage));
  }

  private setupLeaderElection(): void {
    const unsub: () => void = this.io.onEvent<{ isLeader: boolean; leaderId: string }>(
      'leader-changed',
      async ({ isLeader, leaderId }) => {
        debugLog('ConnectionService', `ConnectionManager: Leader changed - isLeader: ${isLeader}, leaderId: ${leaderId}`);
        if (isLeader) {
          debugLog('ConnectionService', 'ConnectionManager: Became leader, attempting to establish connection');
          await attemptLeaderConnection(
            this.state, this.io,
            () => this.getActiveSessions(),
            (sessions) => this.autoReconnectInternal(sessions),
          );
        }
      }
    );
    this.state.addCleanupFunction(unsub);
  }

  private async autoReconnectInternal(activeSessions: ActiveSession[]): Promise<void> {
    await autoReconnect(
      activeSessions, this.state, this.io,
      () => this.getActiveSessions(),
      (cid, update) => handleSuccessfulConnection(cid, update, this.state, this.io),
    );
  }

  // ============================================================================
  // Public API
  // ============================================================================

  public async getActiveSessions(): Promise<ActiveSession[]> {
    return getActiveSessions(this.state, this.io);
  }

  /** The same query, with whether it was actually answered. See queries.ts. */
  public async getActiveSessionsResult(): Promise<ActiveSessionsResult> {
    return getActiveSessionsResult(this.state, this.io);
  }

  public invalidateSessionCache(): void {
    this.state.invalidateCache();
    debugLog('ConnectionService', 'ConnectionManager: Session cache invalidated');
  }

  public async storeSession(session: StoredSession): Promise<void> {
    await storeSession(session, this.state, this.io);
  }

  public async triggerAutoConnect(): Promise<void> {
    debugLog('ConnectionService', 'ConnectionManager: Manually triggering auto-connect');
    const active: ActiveSession[] = await this.getActiveSessions();
    await loadStoredSessions(this.state, this.io);
    if (this.state.storedSessions.sessions.length > 0) {
      this.state.resetReconnectAttempts();
      await this.autoReconnectInternal(active);
    }
  }

  public async reconnectToStoredSessions(): Promise<void> {
    debugLog('ConnectionService', 'ConnectionManager: Reconnecting to stored sessions');
    const currentSession: StoredSession | null = await this.getTabSelectedSession();
    if (currentSession?.cid) {
      await this.io.disconnect(currentSession.cid);
    }
    await new Promise((resolve) => setTimeout(resolve, POST_DISCONNECT_DELAY_MS));
    await this.triggerAutoConnect();
  }

  public async setActiveSessionIndex(index: number): Promise<void> {
    await setActiveSessionIndex(index, this.state, this.io);
  }

  public async clearStoredSessions(): Promise<void> {
    await clearStoredSessions(this.state, this.io);
  }

  public getStoredSessions(): StoredSessions { return this.state.storedSessions; }

  /** Re-read the stored list: another tab of this browser may have added an account since boot. */
  public async reloadStoredSessions(): Promise<StoredSessions> {
    await loadStoredSessions(this.state, this.io);
    return this.state.storedSessions;
  }

  public async handleAuthSuccess(params: AuthSuccessParams): Promise<void> {
    await handleAuthSuccess(params, this.state, this.io);
  }

  public async handleLogout(username: string, serverAddress: string, cid: bigint): Promise<void> {
    await handleLogout(username, serverAddress, cid, this.state, this.io);
  }

  public getConnectionInfo(): CurrentConnectionInfo | null {
    return this.state.currentConnectionInfo;
  }

  public async getTabSelectedSession(): Promise<StoredSession | null> {
    return tabSelectedSession(this.state.storedSessions, await this.io.getSelectedUser());
  }

  public getStoredSessionsArray(): StoredSession[] { return this.state.getSessionsArray(); }

  public async removeSession(username: string, serverAddress: string): Promise<void> {
    await removeSession(username, serverAddress, this.state, this.io);
  }

  public async removeAllSessions(): Promise<void> {
    await removeAllSessions(this.state, this.io, () => this.disconnect());
  }

  public async disconnect(session?: { cid: bigint; username?: string; serverAddress?: string }): Promise<void> {
    try {
      await disconnectSession(session, this.state, this.io);
    } catch (error) {
      debugLog('ConnectionService', 'Failed to disconnect', error);
      throw error;
    }
  }

  public async switchAccount(username: string, serverAddress: string): Promise<void> {
    try {
      await switchAccount(
        username, serverAddress, this.state, this.io,
        () => this.disconnect(),
        (s) => this.storeSession(s),
      );
    } catch (error) {
      debugLog('ConnectionService', 'Failed to switch account', error);
      throw error;
    }
  }

  public async updateSessionRole(username: string, serverAddress: string, role: string, administers: boolean): Promise<void> {
    await updateSessionRole(username, serverAddress, role, administers, this.state, this.io, (s) => this.storeSession(s));
  }
}

// Export singleton instance
export const connectionManager: ConnectionManager = ConnectionManager.getInstance();
