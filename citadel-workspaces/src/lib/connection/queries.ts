/**
 * Connection Queries
 *
 * Handles active session fetching, tab selection lookups,
 * and connect failure processing for the ConnectionManager.
 */

import type { ConnectionState } from './state';
import { isConnectAlreadyInProgress } from '@/lib/connection/is-connect-in-progress';
import { failOnSocketLoss } from '../websocket/request-response';
import type { ConnectionIO } from './io';
import type { ActiveSession, SignedOutAccount, StoredSession } from '@/types/session-types';
import {
  WEBSOCKET_INIT_TIMEOUT_MS,
  GET_SESSIONS_TIMEOUT_MS,
} from './constants';
import { debugLog } from '@/lib/debug-config';
import { sessionIsOnServer } from '@/lib/sessions/same-server';
import { tabSelectedSession } from './tab-session';

/**
 * The outcome of asking the internal service which sessions exist.
 *
 * `ok: false` means the question could not be asked or was not answered — the
 * socket was not up, the tab could not send, or the response timed out. It does
 * NOT mean there are no sessions, and the two must never be conflated: this
 * query is how the app decides whether the user is logged in.
 */
export interface ActiveSessionsResult {
  ok: boolean;
  sessions: ActiveSession[];
  /** Accounts the agent signed out after a failed reconnect; see SignedOutAccount. */
  signedOut: SignedOutAccount[];
}

/** One GetSessions answer, as cached: what an `ok` result carries. */
export type SessionsAnswer = Omit<ActiveSessionsResult, 'ok'>;

const NO_ANSWER: ActiveSessionsResult = { ok: false, sessions: [], signedOut: [] };

/**
 * Get active sessions with caching and deduplication.
 *
 * Keeps the lenient contract its eight callers were written against — an empty
 * array on failure — because most of them genuinely want best effort. Callers
 * that must not read a failure as "you have no sessions" use
 * `getActiveSessionsResult` instead.
 */
export async function getActiveSessions(
  state: ConnectionState,
  io: ConnectionIO,
): Promise<ActiveSession[]> {
  return (await getActiveSessionsResult(state, io)).sessions;
}

export async function getActiveSessionsResult(
  state: ConnectionState,
  io: ConnectionIO,
): Promise<ActiveSessionsResult> {
  const cached: SessionsAnswer | null = state.cachedSessions;
  if (cached && state.isCacheValid()) {
    return { ok: true, ...cached };
  }

  const pending: Promise<ActiveSessionsResult> | null = state.pendingGetSessions;
  if (pending) {
    return pending;
  }

  const fetchPromise: Promise<ActiveSessionsResult> = fetchActiveSessions(state, io);
  state.setPendingGetSessions(fetchPromise);

  try {
    const result: ActiveSessionsResult = await fetchPromise;
    // A failure is not an answer, so it is not cached. It used to be: one
    // timeout produced an empty list that every later call returned instantly
    // for the whole cache window, without re-asking. That is what turned a
    // transient hiccup into a logged-out-looking app that would not recover.
    if (result.ok) state.setCachedSessions({ sessions: result.sessions, signedOut: result.signedOut });
    return result;
  } finally {
    state.setPendingGetSessions(null);
  }
}

interface WireSessions { sessions?: ActiveSession[]; signed_out?: SignedOutAccount[] }

async function fetchActiveSessions(
  state: ConnectionState,
  io: ConnectionIO,
): Promise<ActiveSessionsResult> {
  try {
    // canSendRequests, not isConnected. A FOLLOWER tab never owns a WASM client
    // — that is by design — so `isConnected` is false forever there, and this
    // returned [] WITHOUT ever sending GetSessions, then cached the empty
    // answer. A second tab in the same browser therefore showed the logged-out
    // landing page with no Active Sessions strip, permanently.
    if (!io.canSendRequests()) {
      try {
        await Promise.race([
          io.waitForWebSocketInit(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('WebSocket init timeout')), WEBSOCKET_INIT_TIMEOUT_MS)
          ),
        ]);
      } catch {
        return NO_ANSWER;
      }

      if (!io.canSendRequests()) {
        return NO_ANSWER;
      }
    }

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();

    const responsePromise: Promise<WireSessions> = new Promise<WireSessions>((resolve, reject): void => {
      state.setPendingRequest(requestId, { resolve: resolve as (value: unknown) => void, reject });

      setTimeout(() => {
        if (state.hasPendingRequest(requestId)) {
          state.deletePendingRequest(requestId);
          reject(new Error('GetSessions request timed out'));
        }
      }, GET_SESSIONS_TIMEOUT_MS);
    });

    await io.sendWebSocketMessage({ GetSessions: { request_id: requestId } });

    const response: WireSessions = await failOnSocketLoss('GetSessions', responsePromise);
    // `signed_out` is absent from an agent older than 0.8.4, which signs no one
    // out: the agent's own type defaults it to empty for exactly that case.
    return { ok: true, sessions: response.sessions || [], signedOut: response.signed_out ?? [] };
  } catch (error) {
    debugLog('ConnectionService', 'Failed to get active sessions', error);
    return NO_ANSWER;
  }
}

/**
 * Handle a ConnectFailure response by emitting appropriate events.
 */
export async function handleConnectFailure(
  failure: { message?: string },
  state: ConnectionState,
  io: ConnectionIO,
  getActiveSessionsFn: () => Promise<ActiveSession[]>,
): Promise<void> {
  debugLog('ConnectionService', 'ConnectionManager: Received ConnectFailure:', failure);
  const errorMessage: string = failure.message || '';

  if (!isConnectAlreadyInProgress(errorMessage)) {
    return;
  }

  debugLog('ConnectionService', 'ConnectionManager: Session already connected error detected');
  const extractedCid: string | null = state.extractCidFromErrorMessage(errorMessage);

  if (extractedCid) {
    debugLog('ConnectionService', 'ConnectionManager: Existing session CID from message:', extractedCid);
    io.emitEvent('session-already-connected', { cid: extractedCid, message: errorMessage });
    return;
  }

  debugLog('ConnectionService', 'ConnectionManager: No CID in error message, fetching active sessions...');
  try {
    const activeSessions: ActiveSession[] = await getActiveSessionsFn();
    debugLog('ConnectionService', 'ConnectionManager: Active sessions after error:', activeSessions);

    const currentSession: StoredSession | null = tabSelectedSession(state.storedSessions, await io.getSelectedUser());

    const matchingSession: ActiveSession | undefined = activeSessions.find(
      (s) =>
        currentSession &&
        s.username === currentSession.username &&
        sessionIsOnServer(s, currentSession.serverAddress)
    );

    if (matchingSession) {
      debugLog('ConnectionService', 'ConnectionManager: Found matching active session:', matchingSession);
      io.emitEvent('session-already-connected', {
        cid: matchingSession.cid.toString(),
        message: errorMessage,
      });
    } else {
      debugLog('ConnectionService', 'ConnectionManager: No matching active session found');
    }
  } catch (error) {
    debugLog('ConnectionService', 'Failed to get active sessions:', error);
  }
}
