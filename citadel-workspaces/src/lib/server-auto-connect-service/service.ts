/**
 * Reconnects sessions the user did not sign out of.
 *
 * The backoff lives in reconnect-logic, the settings in init-settings and
 * persistence, what ends an attempt in attempt-lifecycle, which responses are
 * handled in websocket-responses, and the sign-out record in sign-out-record.
 * What is left here is the singleton and its lifecycle.
 */

import { instanceManager } from '@/lib/multi-instance';
import type { StoredSession } from '@/types/session-types';
import { EventListenerPollingService } from '@/lib/utils/polling-service';
import type { WebSocketMessage } from '@/types/ws-message-types';
import { clearPendingAttempts } from './attempt-lifecycle';
import { signOutKey } from './sign-out-record';
import { dispatchWebSocketResponse } from './websocket-responses';
import { debugLog, errorLog } from '@/lib/debug-config';
import { loadAutoConnectSettings, type AutoConnectSettings } from './init-settings';
import { TIMEOUT } from '@/lib/timeout-constants';
import { POLL_INTERVAL_MS , type ConnectionAttempt } from './types';
import {
  loadEnabledSetting,
  saveEnabledSetting,
  loadUserDisconnectedSessions,
  persistUserDisconnectedSessions,
} from './persistence';
import { applyConnectionSuccess, connectionSuccessDeps } from './connection-success';
import {
  reconnectToDisconnectedSessions,
  scheduleReconnect as doScheduleReconnect,
  cancelRetry as doCancelRetry,
  cancelAllRetries as doCancelAllRetries,
} from './reconnect-logic';

export class ServerAutoConnectService extends EventListenerPollingService {
  private static instance: ServerAutoConnectService;

  private reconnectAttempts: Map<string, ConnectionAttempt> = new Map<string, ConnectionAttempt>();
  private activeSessionKeys: Set<string> = new Set<string>();
  private userDisconnectedSessions: Set<string> = new Set<string>();
  private isEnabled: boolean = true;
  private isInitialized: boolean = false;

  private constructor() {
    super();
    this.setupEventListeners();
  }

  protected getPollingIntervalMs(): number {
    return POLL_INTERVAL_MS;
  }

  protected async poll(): Promise<void> {
    if (!this.isEnabled || !instanceManager.isLeader) return;
    await reconnectToDisconnectedSessions(
      this.isEnabled,
      this.reconnectAttempts,
      this.userDisconnectedSessions,
      (key, session) => this.scheduleReconnect(key, session)
    );
  }

  public static getInstance(): ServerAutoConnectService {
    if (!ServerAutoConnectService.instance) {
      ServerAutoConnectService.instance = new ServerAutoConnectService();
    }
    return ServerAutoConnectService.instance;
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    const settings: AutoConnectSettings = await loadAutoConnectSettings(
      { loadEnabled: loadEnabledSetting, loadUserDisconnected: loadUserDisconnectedSessions },
      (error: unknown) =>
        errorLog(
          'ServerAutoConnectService',
          'Could not read the auto-connect settings; staying off until they can be read:',
          error,
        ),
    );
    this.isEnabled = settings.enabled;
    this.userDisconnectedSessions = settings.userDisconnectedSessions;
    this.isInitialized = settings.initialized;
    debugLog(
      'ServerAutoConnectService',
      `Initialized (enabled: ${this.isEnabled}, userDisconnectedSessions: ` +
        `${this.userDisconnectedSessions.size}, initialized: ${this.isInitialized})`,
    );
  }

  protected setupEventListeners(): void {
    this.listen('auth:success', () => {
      debugLog('ServerAutoConnectService', 'Auth success detected, starting polling after delay');
      setTimeout(() => this.startPolling(), TIMEOUT.SESSION_MANAGEMENT_MS);
    });

    this.listen('p2p:registration-service-stopped', () => {
      debugLog('ServerAutoConnectService', 'Logout detected, stopping polling');
      this.stopPolling();
      this.cancelAllRetries();
    });

    this.listen<WebSocketMessage>('websocket-message', async (message) => {
      await dispatchWebSocketResponse(message, {
        onConnectSuccess: (cid) => this.handleConnectionSuccess(cid),
        onConnectFailure: (failure) => this.handleConnectionFailure(failure),
        onSessionAlreadyActive: () => this.handleSessionAlreadyActive(),
        onDisconnect: (notification) => this.handleDisconnect(notification),
      });
    });

    this.listen<{ isLeader: boolean; leaderId: string }>('instance:leader-changed', (data) => {
      debugLog('ServerAutoConnectService', `Leader changed - isLeader: ${data.isLeader}`);
      if (data.isLeader) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.cancelAllRetries();
      }
    });
  }

  public async getEnabled(): Promise<boolean> {
    if (!this.isInitialized) await this.init();
    return this.isEnabled;
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    try {
      // Assigned only after the write lands. Setting it first meant a failed
      // save left the service running the NEW value while the UI reverted its
      // switch and told the user it had not saved — and the next getEnabled()
      // reported the value the user had just been told was rejected.
      await saveEnabledSetting(enabled);
      this.isEnabled = enabled;
      if (enabled) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.cancelAllRetries();
      }
    } catch (error) {
      debugLog('ServerAutoConnectService', 'Failed to save enabled setting:', error);
      throw error;
    }
  }

  public triggerReconnect(): void {
    if (!this.isEnabled) {
      debugLog('ServerAutoConnectService', 'Poll skipped (disabled)');
      return;
    }
    if (!instanceManager.isLeader) {
      debugLog('ServerAutoConnectService', 'Poll skipped (not leader tab)');
      return;
    }
    this.triggerPoll().catch((err) => {
      debugLog('ServerAutoConnectService', 'Poll failed:', err);
    });
  }

  public override startPolling(): void {
    if (!this.isEnabled) {
      debugLog('ServerAutoConnectService', 'Polling not started (disabled)');
      return;
    }
    if (!instanceManager.isLeader) {
      debugLog('ServerAutoConnectService', 'Polling not started (not leader tab)');
      return;
    }
    debugLog('ServerAutoConnectService', `Starting background polling (interval: ${POLL_INTERVAL_MS / 1000}s)`);
    this.triggerReconnect();
    super.startPolling();
  }

  public override stopPolling(): void {
    super.stopPolling();
    debugLog('ServerAutoConnectService', 'Stopped background polling');
  }

  private scheduleReconnect(sessionKey: string, session: StoredSession): void {
    doScheduleReconnect(this.reconnectAttempts, sessionKey, session);
  }

  /** See connection-success.ts for what this used to read, and why nothing ran. */
  private async handleConnectionSuccess(cid: bigint | undefined): Promise<void> {
    if (cid === undefined) return;
    await applyConnectionSuccess(connectionSuccessDeps({
      cancelRetry: (key: string): void => { this.cancelRetry(key); },
      markActive: (key: string): void => { this.activeSessionKeys.add(key); },
      userDisconnected: this.userDisconnectedSessions,
    }), cid);
  }

  /** A failed connect must stop blocking the next attempt — see attempt-lifecycle. */
  private handleConnectionFailure(connectFailure: { message?: string }): void {
    debugLog('ServerAutoConnectService', 'Connection failure:', connectFailure.message);
    clearPendingAttempts(this.reconnectAttempts, (k) => this.cancelRetry(k), 'ConnectFailure');
  }

  /**
   * The session is already up, which is the opposite of needing a reconnect.
   *
   * The agent answers this when a Connect names a username it already holds a
   * live session for — the ordinary response to the storm one failed
   * GetSessions used to cause, and nothing listened for it.
   */
  private handleSessionAlreadyActive(): void {
    clearPendingAttempts(this.reconnectAttempts, (k) => this.cancelRetry(k), 'SessionAlreadyActive');
  }

  private handleDisconnect(notification: { cid?: bigint }): void {
    const cid: string | undefined = notification.cid?.toString();
    debugLog('ServerAutoConnectService', `Disconnect notification for CID ${cid}`);
    if (this.isEnabled) {
      setTimeout(() => this.triggerReconnect(), 1000);
    }
  }

  /**
   * Record, in memory, that the user signed out. Separate from the persistence
   * below: they have different deadlines — see lib/connection/lifecycle.ts.
   */
  public markUserDisconnectedNow(username: string, serverAddress: string): void {
    this.userDisconnectedSessions.add(signOutKey(username, serverAddress));
    this.cancelRetry(signOutKey(username, serverAddress));
  }

  /** Persist what `markUserDisconnectedNow` recorded. Best-effort. */
  public async persistUserDisconnected(): Promise<void> {
    await persistUserDisconnectedSessions(this.userDisconnectedSessions);
  }

  /** Both halves, for callers with no disconnect waiting on the write. */
  public async markUserDisconnected(username: string, serverAddress: string): Promise<void> {
    this.markUserDisconnectedNow(username, serverAddress);
    await this.persistUserDisconnected();
  }

  public cancelRetry(sessionKey: string): void {
    doCancelRetry(this.reconnectAttempts, sessionKey);
  }

  public cancelAllRetries(): void {
    doCancelAllRetries(this.reconnectAttempts, this.activeSessionKeys);
  }

  public getPendingReconnectCount(): number {
    return this.reconnectAttempts.size;
  }
}
