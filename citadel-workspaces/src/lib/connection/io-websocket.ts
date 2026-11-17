/**
 * Connection I/O - WebSocket & LocalDB Operations
 *
 * Handles WebSocket transport and LocalDB persistence.
 * Part of the ConnectionIO class (SBIO pattern).
 */

// Namespace import breaks circular dependency:
// websocket-service/index.ts → core.ts → connection/ → io.ts → THIS FILE → websocket-service (TDZ)
// With `import *`, the namespace object is created immediately but its properties are
// live bindings — reading `wsModule.websocketService` is deferred until call time,
// by which point the cycle has fully resolved and the singleton is initialized.
import * as wsModule from '../websocket-service';
import { markSessionsRead, sessionsHaveBeenRead } from './sessions-read-state';
import { scrubLegacyCredentials, type ScrubResult } from './scrub-legacy-credentials';
import { dropUnaddressedDuplicates } from './drop-unaddressed-duplicates';
import { failOnSocketLoss } from '../websocket/request-response';
import { persistJSON, parsePersistedJSON } from '../storage-utils';
import { formatForDebug } from '../debug-formatter';
import { stringToBytes, bytesToString } from '../utils/encoding-utils';
import type { SessionSecuritySettings } from '../p2p-registration-service';
import type { StoredSession, StoredSessions, GetSessionsRequest, GetSessionsResponse } from '@/types/session-types';
import type { ConnectionIntent, PendingRequest } from './types';
import { SESSION_STORAGE_KEY } from '@/types/session-types';
import { debugLog, debugEnabled } from '@/lib/debug-config';
import { passwordOnly } from '@/lib/sign-in/factors';

/**
 * WebSocket and LocalDB I/O operations.
 * Extracted from ConnectionIO for file size compliance.
 */
export class ConnectionIOWebSocket {
  async executeWebSocketIntent(intent: ConnectionIntent): Promise<unknown> {
    switch (intent.type) {
      case 'init-websocket':
        return this.initWebSocket();
      case 'set-orphan-mode':
        return this.setOrphanMode(intent.enabled);
      case 'send-websocket-message':
        return this.sendWebSocketMessage(intent.message);
      case 'connect':
        return this.connect(intent);
      case 'disconnect':
        return this.disconnect(intent.cid);
      case 'claim-session':
        return this.claimSession(intent.cid, intent.onlyIfOrphaned);
      case 'localdb-set':
        return this.localDBSet(intent.cid, intent.key, intent.value);
      case 'localdb-get':
        return this.localDBGet(intent.cid, intent.key);
      default:
        return undefined;
    }
  }

  // ============================================================================
  // WebSocket Operations
  // ============================================================================

  async initWebSocket(): Promise<void> {
    await wsModule.websocketService.init();
  }

  setOrphanMode(enabled: boolean): void {
    wsModule.websocketService.setOrphanModeNonBlocking(enabled);
  }

  async sendWebSocketMessage(message: unknown): Promise<void> {
    await wsModule.websocketService.sendMessage(message as Record<string, unknown>);
  }

  // `isWebSocketConnected` used to live here, forwarding `isConnected()` --
  // which asks whether THIS tab owns a WASM client and is false in every
  // follower for ever. It had no callers at all, so it was a trap rather than a
  // bug: the next caller would have gated a send on it, exactly as four other
  // call sites already had. `canSendRequests` below is the question to ask.

  /** Whether a request can reach the internal service — see core.canSendRequests. */
  canSendRequests(): boolean {
    return wsModule.websocketService.canSendRequests();
  }

  async waitForWebSocketInit(): Promise<void> {
    await wsModule.websocketService.waitForInit();
  }

  async connect(params: {
    requestId: string;
    username: string;
    serverAddress: string;
    password: string;
    sessionSecuritySettings?: SessionSecuritySettings;
  }): Promise<void> {
    await wsModule.websocketService.connect(
      params.requestId,
      params.username,
      params.serverAddress,
      passwordOnly(params.password),
      params.sessionSecuritySettings
    );
  }

  async disconnect(cid: bigint): Promise<void> {
    await wsModule.websocketService.disconnect(cid);
  }

  async claimSession(cid: bigint, onlyIfOrphaned: boolean): Promise<unknown> {
    return wsModule.websocketService.claimSession(cid, onlyIfOrphaned);
  }

  // ============================================================================
  // LocalDB Operations
  // ============================================================================

  async localDBSet(cid: bigint, key: string, value: number[]): Promise<void> {
    await wsModule.websocketService.sendLocalDBSet(cid, key, value);
  }

  async localDBGet(cid: bigint, key: string): Promise<{ value: number[] } | null> {
    return wsModule.websocketService.sendLocalDBGet(cid, key);
  }

  async storeSessionsToLocalDB(sessions: StoredSessions): Promise<void> {
    if (!sessionsHaveBeenRead()) {
      // The key is SHARED across tabs and this writes the whole list. That is
      // only sound when the list came from the key; if the read failed, the
      // list is empty for a reason unrelated to what is stored, and writing it
      // deletes every remembered account -- silently, because the write
      // succeeds.
      //
      // Round 596 narrowed two of these writes to a single-session upsert
      // (persist-one-session.ts) and left five whole-list writers behind, in
      // session-list.ts, session-management.ts and service.ts. The guard is
      // here, on the one method all five call, rather than at those five
      // sites: a guard applied at some of the places its mechanism appears is
      // this repository's most common defect, and it is the shape that fix
      // itself had.
      throw new Error(
        'Refusing to write the stored-session list: it was never successfully ' +
          'read, so writing it would erase every remembered account.',
      );
    }
    const valueStr: string = persistJSON(sessions);
    // Guarded: `formatForDebug` JSON.parses the string and rebuilds the whole
    // object recursively, and this runs on every session-store write -- auth,
    // auto-reconnect, logout, role update, active-index change. debugLog is a
    // noop in production but its ARGUMENTS are evaluated, so unguarded this
    // rebuilt the entire stored-session list and discarded it. Rollup drops the
    // branch from the production bundle, so the guard costs nothing.
    if (debugEnabled) {
      debugLog('ConnectionIO', 'Storing sessions, serialized:', formatForDebug(valueStr));
    }
    const valueBytes: number[] = stringToBytes(valueStr);
    await this.localDBSet(0n, SESSION_STORAGE_KEY, valueBytes);
  }

  async loadSessionsFromLocalDB(): Promise<StoredSessions | null> {
    // Deliberately NOT wrapped in a catch. A failed read must reach the
    // caller, which classifies it with isGenuinelyAbsent; swallowing it here
    // would put the decision in the one place that cannot tell the two cases
    // apart. `sessionsWereRead` is set only on the paths that reached the key.
    const result: { value: number[]; } | null = await this.localDBGet(0n, SESSION_STORAGE_KEY);
    markSessionsRead();
    if (result && result.value) {
      try {
        const jsonStr: string = bytesToString(result.value);
        // StoredSession.cid is a bigint and exists specifically so an orphaned
        // session can be reclaimed; a bare JSON.parse gave it back as a string.
        const parsed: StoredSessions = parsePersistedJSON<StoredSessions>(jsonStr, ['cid']);
        return await this.withLegacyEntriesRepaired(parsed);
      } catch (decodeError) {
        debugLog('ConnectionIO', 'Failed to decode stored sessions:', decodeError);
        return null;
      }
    }
    return null;
  }

  /**
   * Every read path passes through here, so no in-memory copy -- and no
   * read-modify-write built on one -- carries a plaintext password or a
   * serverless duplicate onward. The write-back repairs the agent's store; if
   * that write fails, the next read tries again.
   */
  private async withLegacyEntriesRepaired(parsed: StoredSessions): Promise<StoredSessions> {
    const scrub: ScrubResult = scrubLegacyCredentials(parsed);
    const deduped: { sessions: StoredSession[]; removed: number } = dropUnaddressedDuplicates(scrub.sessions.sessions);
    // The active entry by identity, since dropping entries shifts positions; a dropped
    // serverless entry hands the selection to the addressed record of the same account.
    const active: StoredSession | undefined = scrub.sessions.sessions[scrub.sessions.activeSessionIndex ?? -1];
    const kept: number = active ? deduped.sessions.indexOf(active) : -1;
    const activeIndex: number = kept >= 0 || !active ? kept : deduped.sessions.findIndex((s: StoredSession) => s.username === active.username);
    const repaired: StoredSessions = {
      ...scrub.sessions,
      sessions: deduped.sessions,
      activeSessionIndex: activeIndex >= 0 ? activeIndex : undefined,
    };
    if (scrub.scrubbed > 0 || deduped.removed > 0) {
      try {
        await this.storeSessionsToLocalDB(repaired);
        debugLog('ConnectionIO', 'Repaired stored sessions: plaintext removed from', scrub.scrubbed, '; serverless duplicates dropped:', deduped.removed);
      } catch (error) {
        debugLog('ConnectionIO', 'Could not write back repaired sessions; will retry on next read', error);
      }
    }
    return repaired;
  }

  // ============================================================================
  // GetSessions Request Helper
  // ============================================================================

  async sendGetSessionsRequest(
    requestId: string,
    pendingRequests: Map<string, PendingRequest>,
    timeoutMs: number
  ): Promise<GetSessionsResponse> {
    const request: GetSessionsRequest = { request_id: requestId };

    const responsePromise: Promise<GetSessionsResponse> = new Promise<GetSessionsResponse>((resolve, reject) => {
      pendingRequests.set(requestId, { resolve: resolve as (value: unknown) => void, reject });

      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error('GetSessions request timed out'));
        }
      }, timeoutMs);
    });

    await this.sendWebSocketMessage({ GetSessions: request });
    return failOnSocketLoss('GetSessions', responsePromise);
  }
}
