/**
 * What to do when a stored session reconnects successfully.
 *
 * This used to live inline in the service, reading `username` and `server_addr`
 * off the `ConnectSuccess` message and doing all of its work inside
 * `if (username)`. `ConnectSuccess` has neither field — Rust declares
 * `{ cid, request_id }` and the generated binding agrees — so the body never
 * ran. The retry for a session that had just reconnected was never cancelled,
 * and ServerAutoConnect retrying a settled connection is a known cause of P2P
 * flakiness here.
 *
 * The `cid` the message DOES carry identifies the session: `StoredSession.cid`
 * is recorded at login. The session key is built by `getSessionKey`, the same
 * helper the scheduling side uses, so the two cannot drift apart — a retry
 * cancelled under a differently-spelled key is a retry that keeps running.
 */
import { debugLog } from '@/lib/debug-config';
import { connectionManager } from '@/lib/connection';
import { persistUserDisconnectedSessions } from './persistence';
import { getSessionKey } from './reconnect-logic';
import type { StoredSession } from '@/types/session-types';

export interface ConnectionSuccessDeps {
  sessions: StoredSession[];
  cancelRetry: (sessionKey: string) => void;
  markActive: (sessionKey: string) => void;
  userDisconnected: Set<string>;
  persist: (keys: Set<string>) => Promise<void>;
}

/** Returns the session key acted on, or null when the cid matches no session. */
export async function applyConnectionSuccess(
  deps: ConnectionSuccessDeps,
  cid: bigint,
): Promise<string | null> {
  const session: StoredSession | undefined = deps.sessions.find((s) => s.cid === cid);
  if (!session) {
    // The success may belong to a session this device never stored. Acting on
    // "the" session without knowing which one would cancel another's retry.
    debugLog('ServerAutoConnectService', `ConnectSuccess for unknown cid ${cid.toString()}`);
    return null;
  }

  const sessionKey: string = getSessionKey(session);
  deps.cancelRetry(sessionKey);
  deps.markActive(sessionKey);

  if (deps.userDisconnected.has(sessionKey)) {
    deps.userDisconnected.delete(sessionKey);
    await deps.persist(deps.userDisconnected);
  }

  debugLog('ServerAutoConnectService', `Connection successful for ${session.username}`);
  return sessionKey;
}

/**
 * The live wiring: stored sessions from the connection manager, persistence
 * from this service's own module. Assembled here rather than in the service so
 * the two halves of one decision sit together.
 */
export function connectionSuccessDeps(
  from: Pick<ConnectionSuccessDeps, 'cancelRetry' | 'markActive' | 'userDisconnected'>,
): ConnectionSuccessDeps {
  return {
    ...from,
    sessions: connectionManager.getStoredSessions().sessions,
    persist: (keys: Set<string>): Promise<void> => persistUserDisconnectedSessions(keys),
  };
}
