/**
 * Request-Response Pattern
 *
 * Generic utility for the repeated pattern of:
 * 1. Send a request via WebSocket
 * 2. Listen for a success/failure response matched by request_id
 * 3. Clean up timeout + listener on resolution
 *
 * Eliminates ~500 lines of duplicated boilerplate across
 * local-db-operations, p2p-operations, disconnect-operations,
 * and session-management.
 */

import { eventEmitter } from '../event-emitter';
import { onSocketLost } from './socket-loss';
import { debugLog } from '../debug-config';

export interface ResponseMatcher<T> {
  /** Return extracted data on success match, undefined to skip */
  matchSuccess: (message: Record<string, unknown>) => T | undefined;
  /** Return error message on failure match, undefined to skip */
  matchFailure: (message: Record<string, unknown>) => string | undefined;
}

export interface RequestResponseOptions<T> {
  request: unknown;
  requestId: string;
  sendRequest: (request: unknown, requestId?: string) => Promise<void>;
  timeoutMs: number;
  operationName: string;
  matcher: ResponseMatcher<T>;
}

/**
 * A pending request cannot outlive the socket it was sent on.
 *
 * When the WebSocket dies, the internal service has no route back: it keys
 * responses to the connection that asked, and a reconnect is a NEW connection
 * with a new uuid. So every request in flight at that moment is already dead —
 * but each one used to sit out its full budget first, and those budgets are not
 * small: 30s for a peer connect or a disconnect, 35s for a peer list, 60s for a
 * file download, 120s for the file picker. The user watches a spinner for a
 * minute over a socket that is gone, and then gets "timed out", which names the
 * wrong cause.
 *
 * Rejecting on the drop turns a minute of false hope into an immediate, true
 * message. Only the leader tab's client emits 'websocket-disconnected'; a follower
 * hears the same loss as the leader's report (onSocketLost).
 */
export const CONNECTION_LOST: "the connection to the Citadel agent was lost" = 'the connection to the Citadel agent was lost';

export function requestResponse<T>(options: RequestResponseOptions<T>): Promise<T> {
  const { request, requestId, sendRequest, timeoutMs, operationName, matcher } = options;

  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handler);
      stopListeningForLoss();
    };

    const timeout: NodeJS.Timeout = setTimeout((): void => {
      cleanup();
      reject(new Error(`${operationName} request timed out`));
    }, timeoutMs);

    const onDisconnected = (): void => {
      cleanup();
      reject(new Error(`${operationName} failed: ${CONNECTION_LOST}`));
    };

    const handler = (message: Record<string, unknown>): void => {
      const successData: ReturnType<typeof matcher.matchSuccess> = matcher.matchSuccess(message);
      if (successData !== undefined) {
        cleanup();
        resolve(successData);
        return;
      }

      const failureMsg: string | undefined = matcher.matchFailure(message);
      if (failureMsg !== undefined) {
        cleanup();
        reject(new Error(failureMsg));
      }
    };

    eventEmitter.on('websocket-message', handler);
    const stopListeningForLoss: () => void = onSocketLost(onDisconnected);

    sendRequest(request, requestId).catch(error => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * Variant that resolves void on success/failure (warn-and-continue pattern).
 * Used by operations like acceptPeerConnect that should not reject on failure.
 */
export function requestResponseSoft(options: {
  request: unknown;
  requestId: string;
  sendRequest: (request: unknown, requestId?: string) => Promise<void>;
  timeoutMs: number;
  operationName: string;
  matchSuccess: (message: Record<string, unknown>) => boolean;
  matchFailure: (message: Record<string, unknown>) => string | undefined;
  onTimeout?: () => void;
  onFailure?: (error: string) => void;
}): Promise<void> {
  const { request, requestId, sendRequest, timeoutMs, operationName,
    matchSuccess, matchFailure, onTimeout, onFailure } = options;

  return new Promise<void>((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handler);
      stopListeningForLoss();
    };

    const timeout: NodeJS.Timeout = setTimeout((): void => {
      cleanup();
      if (onTimeout) onTimeout();
      resolve();
    }, timeoutMs);

    // Same reasoning as the strict variant, reported through this one's own
    // failure channel: a soft caller warns and continues, and it should get to
    // do that now rather than in two minutes.
    const onDisconnected = (): void => {
      cleanup();
      if (onFailure) onFailure(`${operationName} failed: ${CONNECTION_LOST}`);
      resolve();
    };

    const handler = (message: Record<string, unknown>): void => {
      if (matchSuccess(message)) {
        cleanup();
        resolve();
        return;
      }

      const failureMsg: string | undefined = matchFailure(message);
      if (failureMsg !== undefined) {
        cleanup();
        if (onFailure) onFailure(failureMsg);
        resolve();
      }
    };

    eventEmitter.on('websocket-message', handler);
    const stopListeningForLoss: () => void = onSocketLost(onDisconnected);

    sendRequest(request, requestId).catch(error => {
      cleanup();
      debugLog('RequestResponse', `Failed to send ${operationName}:`, error);
      resolve();
    });
  });
}

/**
 * Fail `promise` as soon as the socket dies, whatever it was waiting for.
 *
 * `requestResponse` handles this for the callers that use it. Ten more files
 * hand-roll the same wait — file transfers among them, at 30s to 120s each —
 * and each one of those was a minute of spinner over a socket that was already
 * gone. This is the smallest thing that fixes all ten: one wrapper at the
 * return, no surgery on ten different cleanup paths.
 *
 * It frees the CALLER immediately. The wrapped promise keeps its own listener
 * until its own timeout, exactly as it does today — that part is unchanged, and
 * its late settle lands on an already-settled promise rather than becoming an
 * unhandled rejection, because the handlers below stay attached.
 */
export function failOnSocketLoss<T>(operationName: string, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stopListening: () => void = onSocketLost((): void => {
      stopListening();
      reject(new Error(`${operationName} failed: ${CONNECTION_LOST}`));
    });
    promise.then(
      (value) => {
        stopListening();
        resolve(value);
      },
      (error) => {
        stopListening();
        reject(error);
      },
    );
  });
}
