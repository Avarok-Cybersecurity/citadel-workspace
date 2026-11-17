/**
 * Session Management Operations
 *
 * Handles session management via ConnectionManagement requests.
 */

import { requestResponse } from './request-response';
import { eventEmitter } from '../event-emitter';
import { SESSION_CLAIMED, type ClaimedEvent } from '../multi-instance/claim-relay';
import { debugLog } from '../debug-config';
import { TIMEOUT } from '../timeout-constants';
import type { WorkspaceClient } from 'citadel-workspace-client-ts';

export interface SessionManagementConfig {
  init: () => Promise<void>;
  sendRequest: (request: unknown, requestId?: string) => Promise<void>;
  getClient: () => WorkspaceClient | null;
}

export interface SessionManagementResult {
  success: boolean;
  message?: string;
  cid?: bigint;
}

type ConnectionManagementResponse = {
  ConnectionManagementSuccess?: { request_id: string; message?: string; cid?: bigint };
  ConnectionManagementFailure?: { request_id: string; error?: string };
};

export class SessionManagement {
  private readonly config: SessionManagementConfig;

  constructor(config: SessionManagementConfig) {
    this.config = config;
  }

  /**
   * Unwrap the optional Response wrapper that some messages arrive with.
   */
  private static unwrapResponse(message: unknown): ConnectionManagementResponse {
    const msg: { Response?: Record<string, unknown>; } & Record<string, unknown> = message as { Response?: Record<string, unknown> } & Record<string, unknown>;
    return (msg.Response || msg) as ConnectionManagementResponse;
  }

  /**
   * Create a matcher for ConnectionManagement success/failure responses.
   */
  private connectionManagementMatcher(requestId: string): { matchSuccess: (message: Record<string, unknown>) => SessionManagementResult | undefined; matchFailure: (message: Record<string, unknown>) => string | undefined; } {
    return {
      matchSuccess: (message: Record<string, unknown>): SessionManagementResult | undefined => {
        const response: ConnectionManagementResponse = SessionManagement.unwrapResponse(message);
        if (response.ConnectionManagementSuccess?.request_id === requestId) {
          return {
            success: true,
            message: response.ConnectionManagementSuccess.message,
            cid: response.ConnectionManagementSuccess.cid,
          };
        }
        return undefined;
      },
      matchFailure: (message: Record<string, unknown>): string | undefined => {
        const response: ConnectionManagementResponse = SessionManagement.unwrapResponse(message);
        if (response.ConnectionManagementFailure?.request_id === requestId) {
          return response.ConnectionManagementFailure.error || 'Connection management operation failed';
        }
        return undefined;
      },
    };
  }

  async setOrphanMode(enabled: boolean): Promise<SessionManagementResult> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { ConnectionManagement: { request_id: `${string}-${string}-${string}-${string}-${string}`; management_command: { SetConnectionOrphan: { allow_orphan_sessions: boolean; }; }; }; } = {
      ConnectionManagement: {
        request_id: requestId,
        management_command: { SetConnectionOrphan: { allow_orphan_sessions: enabled } }
      }
    };

    debugLog('SessionManagement', 'Sending SetConnectionOrphan request', request);

    return requestResponse<SessionManagementResult>({
      request, requestId, timeoutMs: TIMEOUT.SESSION_MANAGEMENT_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'SetConnectionOrphan',
      matcher: this.connectionManagementMatcher(requestId),
    });
  }

  setOrphanModeNonBlocking(enabled: boolean): void {
    this.setOrphanMode(enabled).catch((err: Error) => {
      debugLog('SessionManagement', 'setOrphanMode failed (non-blocking):', err.message);
    });
  }

  async claimSession(sessionCid: string | bigint, onlyIfOrphaned: boolean = false): Promise<SessionManagementResult> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const sessionCidBigInt: bigint = typeof sessionCid === 'string' ? BigInt(sessionCid) : sessionCid;

    const request: { ConnectionManagement: { request_id: `${string}-${string}-${string}-${string}-${string}`; management_command: { ClaimSession: { session_cid: bigint; only_if_orphaned: boolean; }; }; }; } = {
      ConnectionManagement: {
        request_id: requestId,
        management_command: {
          ClaimSession: { session_cid: sessionCidBigInt, only_if_orphaned: onlyIfOrphaned }
        }
      }
    };

    debugLog('SessionManagement', 'Sending ClaimSession request with CID: ' + sessionCidBigInt.toString());

    const result: SessionManagementResult = await requestResponse<SessionManagementResult>({
      request, requestId, timeoutMs: TIMEOUT.CLAIM_SESSION_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'ClaimSession',
      matcher: this.connectionManagementMatcher(requestId),
    });
    // The connection now carries the session; what is said to the agent per connection
    // (ReportFocus) has to be said again. See multi-instance/claim-relay.ts.
    eventEmitter.emit<ClaimedEvent>(SESSION_CLAIMED, { cid: sessionCidBigInt });
    return result;
  }

  async disconnectOrphan(sessionCid?: string | bigint | null): Promise<SessionManagementResult> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { ConnectionManagement: { request_id: `${string}-${string}-${string}-${string}-${string}`; management_command: { DisconnectOrphan: { session_cid: bigint | null; }; }; }; } = {
      ConnectionManagement: {
        request_id: requestId,
        management_command: {
          DisconnectOrphan: { session_cid: sessionCid ? BigInt(sessionCid) : null }
        }
      }
    };

    debugLog('SessionManagement', 'Sending DisconnectOrphan request', request);

    return requestResponse<SessionManagementResult>({
      request, requestId, timeoutMs: TIMEOUT.CLAIM_SESSION_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'DisconnectOrphan',
      matcher: this.connectionManagementMatcher(requestId),
    });
  }

  releaseSession(sessionCid: bigint): void {
    const client: WorkspaceClient | null = this.config.getClient();
    if (!client) {
      debugLog('SessionManagement', 'Cannot release session - not the leader (no client)');
      return;
    }

    const request: { ConnectionManagement: { request_id: `${string}-${string}-${string}-${string}-${string}`; management_command: { ReleaseSession: { session_cid: bigint; }; }; }; } = {
      ConnectionManagement: {
        request_id: crypto.randomUUID(),
        management_command: { ReleaseSession: { session_cid: sessionCid } }
      }
    };

    debugLog('SessionManagement', `Releasing session ${sessionCid.toString()}`);

    // Fire-and-forget - don't await since tab may be closing
    client.sendDirectToInternalService(request).catch((error: unknown) => {
      debugLog('SessionManagement', 'Failed to release session:', error);
    });
  }
}
