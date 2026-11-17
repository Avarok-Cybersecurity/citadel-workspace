/**
 * Disconnect Operations
 *
 * Handles session disconnect and deregister operations via the internal service.
 * Extracted from websocket-service.ts to reduce file size.
 */

import { requestResponse } from './request-response';
import { endingHereWhile } from '../sessions/ending-here';
import { debugLog, errorLog } from '../debug-config';
import { TIMEOUT } from '../timeout-constants';
import { isNone } from '../wire/none';

export interface DisconnectConfig {
  init: () => Promise<void>;
  sendRequest: (request: unknown, requestId?: string) => Promise<void>;
}

export class DisconnectOperations {
  private readonly config: DisconnectConfig;

  constructor(config: DisconnectConfig) {
    this.config = config;
  }

  /**
   * Disconnect a session from the server.
   * Waits for DisconnectNotification from backend before resolving.
   * This ensures the session is fully cleaned up before the Promise resolves.
   */
  async disconnect(cid: bigint): Promise<void> {
    if (cid === undefined || cid === null) {
      throw new Error('CID is required to disconnect a session');
    }

    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { Disconnect: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; }; } = {
      Disconnect: { request_id: requestId, cid }
    };

    debugLog('DisconnectOperations', 'Sending Disconnect request', request);

    // Marked while it asks: its own answer is not "signed out in another window" (sessions/session-ended.ts).
    await endingHereWhile(cid, async (): Promise<void> => { await requestResponse<true>({
      request, requestId, timeoutMs: TIMEOUT.DISCONNECT_REQUEST_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'Disconnect',
      matcher: {
        matchSuccess: (message) => {
          const response: { DisconnectNotification?: { request_id?: string | null; cid?: bigint; }; } = ((message as { Response?: Record<string, unknown> }).Response || message) as {
            DisconnectNotification?: { request_id?: string | null; cid?: bigint };
          };
          if (response.DisconnectNotification) {
            const n: { request_id?: string | null; cid?: bigint; } = response.DisconnectNotification;
            if (n.request_id === requestId || (isNone(n.request_id) && n.cid === cid)) {
              debugLog('DisconnectOperations', 'Disconnect successful for CID:', cid.toString());
              return true;
            }
          }
          return undefined;
        },
        // BOTH failure variants, because the one this used to read alone is
        // never sent. The service answers a failed C2S disconnect with
        // `PeerDisconnectFailure` -- the handler is shared with the peer path
        // and returns that variant for both -- and nothing in the service ever
        // constructs `DisconnectFailure` at all. So "Server connection not
        // found" was invisible here: no match, no rejection, and the caller sat
        // out the full thirty-second budget before failing with a timeout that
        // said nothing about the reason.
        matchFailure: (message) => {
          const response: {
            DisconnectFailure?: { request_id?: string | null; cid?: bigint; message?: string };
            PeerDisconnectFailure?: { request_id?: string | null; cid?: bigint; message?: string };
          } = ((message as { Response?: Record<string, unknown> }).Response || message) as {
            DisconnectFailure?: { request_id?: string | null; cid?: bigint; message?: string };
            PeerDisconnectFailure?: { request_id?: string | null; cid?: bigint; message?: string };
          };
          const failure: { request_id?: string | null; cid?: bigint; message?: string } | undefined =
            response.DisconnectFailure ?? response.PeerDisconnectFailure;
          if (failure) {
            const f: { request_id?: string | null; cid?: bigint; message?: string; } = failure;
            if (f.request_id === requestId || (isNone(f.request_id) && f.cid === cid)) {
              errorLog('Disconnect failed:', f.message);
              return f.message || 'Failed to disconnect';
            }
          }
          return undefined;
        },
      },
    }); });
  }

  /**
   * Deregister from the server - permanently removes the account.
   * This is different from disconnect which only ends the session.
   * Use this for complete cleanup between test runs.
   */
  async deregister(cid: bigint): Promise<void> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { Deregister: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; }; } = {
      Deregister: { request_id: requestId, cid }
    };

    debugLog('DisconnectOperations', 'Sending Deregister request', request);

    // Marked while it asks: its own answer is not "signed out in another window" (sessions/session-ended.ts).
    await endingHereWhile(cid, async (): Promise<void> => { await requestResponse<true>({
      request, requestId, timeoutMs: TIMEOUT.DISCONNECT_REQUEST_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'Deregister',
      matcher: {
        matchSuccess: (message) => {
          const response: { DeregisterSuccess?: { request_id: string; }; } = ((message as { Response?: Record<string, unknown> }).Response || message) as {
            DeregisterSuccess?: { request_id: string };
          };
          if (response.DeregisterSuccess?.request_id === requestId) {
            debugLog('DisconnectOperations', 'Deregister successful for CID:', cid.toString());
            return true;
          }
          return undefined;
        },
        matchFailure: (message) => {
          const response: { DeregisterFailure?: { request_id: string; message?: string; }; } = ((message as { Response?: Record<string, unknown> }).Response || message) as {
            DeregisterFailure?: { request_id: string; message?: string };
          };
          if (response.DeregisterFailure?.request_id === requestId) {
            return response.DeregisterFailure.message || 'Failed to deregister';
          }
          return undefined;
        },
      },
    }); });
  }
}
