/**
 * Connection State Core
 *
 * Core initialization, leader, connection info, stored sessions,
 * and reconnect state. Part of the ConnectionState class.
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                        CID LIFECYCLE - CRITICAL INFO                         ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║ CID (Client ID) is a persistent 64-bit identifier assigned per account.      ║
 * ║ Only Register creates a new CID. All reconnection scenarios preserve CID.    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import type {
  StoredSession,
  StoredSessions,
} from '@/types/session-types';
import type { CurrentConnectionInfo } from './types';
import { MAX_RECONNECT_ATTEMPTS } from './constants';
import { debugLog } from '@/lib/debug-config';

export class ConnectionStateCore {
  // Core state
  protected _isInitialized: boolean = false;
  protected _storedSessions: StoredSessions = { sessions: [] };
  protected _currentConnectionInfo: CurrentConnectionInfo | null = null;
  protected _reconnectAttempts: number = 0;

  // Ready promise for initialization
  protected _readyPromise: Promise<void>;
  protected _readyResolve: (() => void) | null = null;

  // Cleanup functions for event listeners
  protected _cleanupFunctions: (() => void)[] = [];

  /**
   * Leadership is read from its one source when asked. A copy set from 'leader-changed' lagged
   * 'instance:leader-changed', so a reader in any of that event's listeners saw the old answer.
   */
  constructor(private readonly readLeadership: () => boolean) {
    this._readyPromise = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });
  }

  // ============================================================================
  // Initialization State
  // ============================================================================

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  setInitialized(value: boolean): void {
    this._isInitialized = value;
  }

  get readyPromise(): Promise<void> {
    return this._readyPromise;
  }

  resolveReady(): void {
    if (this._readyResolve) {
      this._readyResolve();
      this._readyResolve = null;
    }
  }

  // ============================================================================
  // Leader State
  // ============================================================================

  get isLeader(): boolean {
    return this.readLeadership();
  }

  // ============================================================================
  // Connection Info
  // ============================================================================

  get currentConnectionInfo(): CurrentConnectionInfo | null {
    return this._currentConnectionInfo;
  }

  setCurrentConnectionInfo(info: CurrentConnectionInfo | null): void {
    debugLog('ConnectionState', '[ConnectionState] setCurrentConnectionInfo called:', {
      newCid: info?.cid?.toString() ?? 'null',
      newUsername: info?.username ?? 'null',
      oldCid: this._currentConnectionInfo?.cid?.toString() ?? 'null',
      oldUsername: this._currentConnectionInfo?.username ?? 'null',
      stack: new Error().stack?.split('\n').slice(1, 5).join(' <- '),
    });
    this._currentConnectionInfo = info;
  }

  updateCurrentConnectionInfo(partial: Partial<CurrentConnectionInfo>): void {
    if (this._currentConnectionInfo) {
      this._currentConnectionInfo = { ...this._currentConnectionInfo, ...partial };
    } else if (partial.cid !== undefined) {
      this._currentConnectionInfo = { cid: partial.cid, ...partial };
    }
  }

  // ============================================================================
  // Stored Sessions
  // ============================================================================

  get storedSessions(): StoredSessions {
    return this._storedSessions;
  }

  setStoredSessions(sessions: StoredSessions): void {
    this._storedSessions = sessions;
  }

  getActiveSessionIndex(): number {
    return this._storedSessions.activeSessionIndex ?? 0;
  }

  setActiveSessionIndex(index: number): void {
    if (index >= 0 && index < this._storedSessions.sessions.length) {
      this._storedSessions.activeSessionIndex = index;
    }
  }

  findSession(username: string, serverAddress: string): StoredSession | undefined {
    return this._storedSessions.sessions.find(
      (s) => s.username === username && s.serverAddress === serverAddress
    );
  }

  findSessionIndex(username: string, serverAddress: string): number {
    return this._storedSessions.sessions.findIndex(
      (s) => s.username === username && s.serverAddress === serverAddress
    );
  }

  addOrUpdateSession(session: StoredSession): void {
    const existingIndex: number = this.findSessionIndex(session.username, session.serverAddress);
    if (existingIndex >= 0) {
      this._storedSessions.sessions[existingIndex] = session;
    } else {
      this._storedSessions.sessions.push(session);
    }
  }

  removeSession(username: string, serverAddress: string): void {
    this._storedSessions.sessions = this._storedSessions.sessions.filter(
      (s) => !(s.username === username && s.serverAddress === serverAddress)
    );
  }

  clearSessions(): void {
    this._storedSessions = { sessions: [] };
  }

  getSessionsArray(): StoredSession[] {
    return [...this._storedSessions.sessions];
  }

  // ============================================================================
  // Reconnect Attempts
  // ============================================================================

  get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  incrementReconnectAttempts(): number {
    this._reconnectAttempts++;
    return this._reconnectAttempts;
  }

  resetReconnectAttempts(): void {
    this._reconnectAttempts = 0;
  }

  hasReachedMaxReconnectAttempts(): boolean {
    return this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS;
  }

  get maxReconnectAttempts(): number {
    return MAX_RECONNECT_ATTEMPTS;
  }

  // ============================================================================
  // Cleanup Functions
  // ============================================================================

  addCleanupFunction(fn: () => void): void {
    this._cleanupFunctions.push(fn);
  }

  executeCleanup(): void {
    for (const cleanup of this._cleanupFunctions) {
      cleanup();
    }
    this._cleanupFunctions = [];
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  extractCidFromErrorMessage(message: string): string | null {
    const cidMatch: RegExpMatchArray | null = message.match(/cid\s*=\s*(\d+)/i);
    return cidMatch ? cidMatch[1] : null;
  }

  createConnectionKey(username: string, serverAddress: string): string {
    return `${username}@${serverAddress}`;
  }

  calculateBackoffDelay(attempt: number, maxDelay: number): number {
    return Math.min(1000 * Math.pow(2, attempt), maxDelay);
  }
}
