/**
 * Centralized Session Startup Service
 *
 * Triggers all background services when a user session becomes active.
 * This ensures consistent startup behavior for:
 * - Initial Connect/Register
 * - ClaimSession (reclaim orphaned session)
 * - Login (credentials after explicit disconnect)
 *
 * All P2P startup logic is centralized here to prevent duplicate
 * service starts and ensure ILM message delivery works after reconnection.
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                        CID LIFECYCLE - CRITICAL INFO                         ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║ CID (Client ID) is a persistent 64-bit identifier assigned per account.      ║
 * ║                                                                              ║
 * ║ | Operation              | CID Behavior                                     |║
 * ║ |------------------------|--------------------------------------------------|║
 * ║ | Register (new account) | NEW CID assigned                                 |║
 * ║ | Login (credentials)    | SAME CID preserved                               |║
 * ║ | ClaimSession (orphan)  | SAME CID preserved                               |║
 * ║ | C2S disconnect+reconnect| SAME CID preserved, rekey works                 |║
 * ║ | TCP drop with orphan   | SAME CID, session persists on server             |║
 * ║                                                                              ║
 * ║ IMPORTANT: Only Register creates a new CID. All reconnection scenarios       ║
 * ║ (login, claim, TCP reconnect) preserve the original CID.                     ║
 * ║                                                                              ║
 * ║ For session startup:                                                         ║
 * ║ - 'connect' activationType: New registration, new CID assigned               ║
 * ║ - 'claim' activationType: Same CID, reconnecting orphaned session            ║
 * ║ - 'login' activationType: Same CID, re-authenticating with credentials       ║
 * ║                                                                              ║
 * ║ The startup sequence resets local connection state but the CID from the      ║
 * ║ event remains the same - we're reconnecting to the SAME session.             ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { eventEmitter } from './event-emitter';
import { runStartupSequence } from './session-startup-sequence';
import { debugLog } from '@/lib/debug-config';

export interface SessionActivatedEvent {
  cid: string;
  username: string;
  serverAddress: string;
  activationType: 'connect' | 'claim' | 'login';
}

class SessionStartupService {
  private static instance: SessionStartupService;
  private lastActivatedCid: string | null = null;
  private isStartingUp: boolean = false;
  // Track when the last reconnection startup completed (for time-based guards)
  private lastReconnectionCompletedAt: number = 0;
  // Grace period in ms after reconnection during which stale cleanup is skipped
  // 15s is needed because Test 8 has multiple steps between reconnection and verification
  private static readonly RECONNECTION_GRACE_PERIOD_MS: number = 15000;

  private constructor() {
    this.setupEventListeners();
  }

  public static getInstance(): SessionStartupService {
    if (!SessionStartupService.instance) {
      SessionStartupService.instance = new SessionStartupService();
    }
    return SessionStartupService.instance;
  }

  private setupEventListeners(): void {
    eventEmitter.on('session:activated', async (event: SessionActivatedEvent) => {
      // Log incoming event for debugging
      debugLog('SessionStartupService', `session:activated received: cid=${event.cid?.slice(0, 8)}, type=${event.activationType}, user=${event.username}`);

      // For 'claim' and 'login' types, ALWAYS run the startup sequence even if same CID
      // - ClaimSession: User is reconnecting after TCP drop - must re-establish P2P connections
      // - Login: User logged back in after explicit disconnect - must re-establish P2P connections
      // Both scenarios preserve the CID, so we can't use CID matching to block them.
      // This is critical for ILM to deliver queued messages after reconnection.
      const isReconnection: boolean = event.activationType === 'claim' || event.activationType === 'login';
      debugLog('SessionStartupService', `isReconnection=${isReconnection} (type=${event.activationType}), lastActivatedCid=${this.lastActivatedCid?.slice(0, 8)}, isStartingUp=${this.isStartingUp}`);

      // Prevent duplicate activations for same CID (except for ClaimSession and Login)
      // Only block duplicate 'connect' events (initial registration) - these should not happen
      // in normal operation but could occur due to event system bugs.
      if (!isReconnection && this.lastActivatedCid === event.cid) {
        debugLog('SessionStartupService', 'SessionStartup: Session already activated for CID:', event.cid.slice(0, 8) + '...');
        debugLog('SessionStartupService', 'BLOCKED: Duplicate CID (non-reconnection)');
        return;
      }

      // Prevent concurrent startup sequences - EXCEPT for reconnection events (claim/login)
      // Reconnection events are more important than regular connect events
      // because they indicate reconnection which REQUIRES P2P re-establishment
      if (this.isStartingUp) {
        if (isReconnection) {
          // Allow reconnection events to preempt - wait for current startup to finish, then re-run
          debugLog('SessionStartupService', `SessionStartup: ${event.activationType} event will wait for current startup, then re-run for CID:`, event.cid.slice(0, 8) + '...');
          debugLog('SessionStartupService', 'RECONNECTION WAITING: Will run after current startup completes');
          // Queue this to run after current startup finishes
          // We use a short delay to let the current startup complete
          setTimeout(() => {
            this.isStartingUp = false; // Force allow next run
            eventEmitter.emit('session:activated', event); // Re-emit to trigger startup
          }, 100);
          return;
        }
        debugLog('SessionStartupService', 'SessionStartup: Startup already in progress, skipping for CID:', event.cid.slice(0, 8) + '...');
        debugLog('SessionStartupService', 'BLOCKED: Concurrent startup in progress (non-reconnection)');
        return;
      }

      this.lastActivatedCid = event.cid;
      this.isStartingUp = true;

      debugLog('SessionStartupService', `SessionStartup: Activating session for ${event.username} (${event.activationType}), CID: ${event.cid.slice(0, 8)}...`);
      debugLog('SessionStartupService', 'PROCEEDING with startup sequence');

      try {
        await runStartupSequence(event, () => {
          this.lastReconnectionCompletedAt = Date.now();
          debugLog('SessionStartupService', `SessionStartup: Reconnection completed, grace period started (${SessionStartupService.RECONNECTION_GRACE_PERIOD_MS}ms)`);
        });
      } finally {
        this.isStartingUp = false;
      }
    });
  }

  /**
   * Reset the service state (e.g., on logout or session change)
   * This allows a new session activation for a different CID
   */
  public reset(): void {
    this.lastActivatedCid = null;
    this.isStartingUp = false;
    debugLog('SessionStartupService', 'SessionStartup: Service state reset');
  }

  /**
   * Get the last activated CID (for debugging)
   */
  public getLastActivatedCid(): string | null {
    return this.lastActivatedCid;
  }

  /**
   * Check if session startup is currently in progress OR we're within the grace period
   * after a reconnection. Used by MembersSection to avoid premature stale conversation cleanup.
   *
   * Returns true if:
   * - Startup sequence is currently running, OR
   * - A reconnection (claim/login) completed less than RECONNECTION_GRACE_PERIOD_MS ago
   */
  public isStartupInProgress(): boolean {
    if (this.isStartingUp) {
      return true;
    }

    // Check grace period after reconnection
    if (this.lastReconnectionCompletedAt > 0) {
      const elapsed: number = Date.now() - this.lastReconnectionCompletedAt;
      if (elapsed < SessionStartupService.RECONNECTION_GRACE_PERIOD_MS) {
        debugLog('SessionStartupService', `[SessionStartup] Within reconnection grace period (${elapsed}ms of ${SessionStartupService.RECONNECTION_GRACE_PERIOD_MS}ms)`);
        return true;
      }
    }

    return false;
  }
}

// Export singleton instance - instantiation sets up event listeners
export const sessionStartupService: SessionStartupService = SessionStartupService.getInstance();
