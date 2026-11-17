/**
 * WASM Connection Manager
 *
 * Maintains messenger handles across leader/follower tab transitions.
 * When a follower tab becomes leader, the in-memory WASM state (including
 * opened messenger handles) is lost. This service polls periodically to
 * ensure the messenger handles remain open.
 *
 * Features:
 * - Multi-session support: Maintains messenger handles for ALL active sessions
 * - Page Visibility API: Reduces polling when tab is hidden
 * - Circuit breaker: Stops polling after repeated failures per CID
 * - Adaptive polling: 5s when visible, 30s when hidden
 *
 * Usage:
 * - Call addSession(cid) after login or session claim
 * - Call removeSession(cid) on logout or disconnect for specific session
 * - Call stop() to stop all session management
 */

import { websocketService } from '../websocket-service';
import { debugLog } from '../debug-config';
import type { SessionState } from './types';
import {
  POLL_INTERVAL_VISIBLE_MS,
  POLL_INTERVAL_HIDDEN_MS,
  MAX_CONSECUTIVE_FAILURES,
} from './types';

export class WasmConnectionManager {
  private static instance: WasmConnectionManager | null = null;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private sessions: Map<string, SessionState> = new Map();
  private currentCid: string | null = null;
  private boundHandleVisibilityChange: () => void;

  private constructor() {
    this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
    }
  }

  static getInstance(): WasmConnectionManager {
    if (!WasmConnectionManager.instance) {
      WasmConnectionManager.instance = new WasmConnectionManager();
    }
    return WasmConnectionManager.instance;
  }

  private handleVisibilityChange(): void {
    if (!this.isRunning || !this.currentCid) return;
    this.restartPolling();
  }

  private getPollingInterval(): number {
    if (typeof document !== 'undefined' && document.hidden) {
      return POLL_INTERVAL_HIDDEN_MS;
    }
    return POLL_INTERVAL_VISIBLE_MS;
  }

  private restartPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }

    if (!this.isRunning || this.sessions.size === 0) return;

    const interval: number = this.getPollingInterval();
    const hidden: boolean = typeof document !== 'undefined' ? document.hidden : false;
    const cids: string[] = Array.from(this.sessions.keys());
    debugLog('WasmConnectionManager', 'Starting polling for all sessions', { interval, hidden, cids });

    this.pollIntervalId = setInterval(async () => {
      for (const [cid, state] of this.sessions) {
        if (!state.circuitBreakerOpen) {
          await this.ensureMessengerOpenForSession(cid);
        }
      }
    }, interval);
  }

  /**
   * @deprecated Use addSession(cid) instead for multi-session support
   */
  async start(cid: string): Promise<void> {
    this.currentCid = cid;
    await this.addSession(cid);
  }

  async addSession(cid: string): Promise<void> {
    if (this.sessions.has(cid)) {
      debugLog('WasmConnectionManager', 'Session already tracked, ensuring messenger open', { cid });
      await this.ensureMessengerOpenForSession(cid);
      return;
    }

    this.sessions.set(cid, {
      cid,
      consecutiveFailures: 0,
      circuitBreakerOpen: false
    });

    debugLog('WasmConnectionManager', `[WASM Connection Manager] Added session: ${cid} (total: ${this.sessions.size})`);
    debugLog('WasmConnectionManager', 'Added session', { cid, totalSessions: this.sessions.size });

    if (!this.isRunning) {
      this.isRunning = true;
    }

    await this.ensureMessengerOpenForSession(cid);
    this.restartPolling();
  }

  removeSession(cid: string): void {
    if (this.sessions.has(cid)) {
      this.sessions.delete(cid);
      debugLog('WasmConnectionManager', `[WASM Connection Manager] Removed session: ${cid} (remaining: ${this.sessions.size})`);
      debugLog('WasmConnectionManager', 'Removed session', { cid, remainingSessions: this.sessions.size });

      if (this.currentCid === cid) {
        this.currentCid = this.sessions.size > 0 ? Array.from(this.sessions.keys())[0] : null;
      }

      if (this.sessions.size === 0) {
        this.stop();
      } else {
        this.restartPolling();
      }
    }
  }

  stop(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.isRunning = false;
    this.currentCid = null;
    this.sessions.clear();
    debugLog('WasmConnectionManager', 'Stopped all sessions');
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getCurrentCid(): string | null {
    return this.currentCid;
  }

  resetCircuitBreaker(cid?: string): void {
    if (cid) {
      const session: SessionState | undefined = this.sessions.get(cid);
      if (session) {
        session.consecutiveFailures = 0;
        session.circuitBreakerOpen = false;
        debugLog('WasmConnectionManager', 'Circuit breaker reset for session', { cid });
      }
    } else {
      for (const session of this.sessions.values()) {
        session.consecutiveFailures = 0;
        session.circuitBreakerOpen = false;
      }
      debugLog('WasmConnectionManager', 'Circuit breaker reset for all sessions');
    }

    if (!this.isRunning && this.sessions.size > 0) {
      this.isRunning = true;
      this.restartPolling();
    }
  }

  getManagedSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  private async ensureMessengerOpenForSession(cid: string): Promise<void> {
    const session: SessionState | undefined = this.sessions.get(cid);
    if (!session) {
      debugLog('WasmConnectionManager', 'Session not found, skipping', { cid });
      return;
    }

    if (session.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      if (!session.circuitBreakerOpen) {
        session.circuitBreakerOpen = true;
        debugLog('WasmConnectionManager', 'Circuit breaker opened for session', {
          failures: session.consecutiveFailures,
          cid
        });
      }
      return;
    }

    try {
      const wasOpened: boolean = await websocketService.ensureMessengerOpen(BigInt(cid));
      if (wasOpened) {
        debugLog('WasmConnectionManager', 'Messenger reopened for session', { cid });
      }
      session.consecutiveFailures = 0;
    } catch (error) {
      session.consecutiveFailures++;
      debugLog('WasmConnectionManager', 'Failed to ensure messenger open for session', {
        cid,
        failures: session.consecutiveFailures,
        maxFailures: MAX_CONSECUTIVE_FAILURES,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  destroy(): void {
    this.stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
    }
    WasmConnectionManager.instance = null;
  }
}

export const wasmConnectionManager: WasmConnectionManager = WasmConnectionManager.getInstance();
