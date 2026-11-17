/**
 * When a scheduled reconnect attempt stops being pending.
 *
 * `reconnectAttempts` had exactly one delete path — `cancelRetry`, reached
 * only from `applyConnectionSuccess` on `ConnectSuccess`. So an attempt that
 * came back `ConnectFailure`, or `SessionAlreadyActive` which was not listened
 * for at all, left its entry behind; the poll's
 * `if (reconnectAttempts.has(sessionKey)) continue` then skipped that account
 * for the life of the tab. Nothing reconnected it until logout, a leader
 * change, or the user toggling the setting off and on.
 *
 * Split out of `service.ts` when that file passed the 250-line cap. It is a
 * cohesive concern — what ends an attempt — rather than an arbitrary slice.
 */
import { debugLog } from '@/lib/debug-config';
import type { ConnectionAttempt } from './types';

/**
 * Clear every pending attempt.
 *
 * All of them, not the one this response belongs to: `ConnectFailure` carries
 * no username, and the next poll re-derives what is genuinely inactive from
 * `getActiveSessionsResult` before scheduling anything. So clearing costs one
 * extra evaluation and never an extra connect.
 *
 * Per-key `cancelRetry`, not `cancelAllRetries`: that helper also clears
 * `activeSessionKeys`, which records which sessions are believed up, and one
 * connect failing says nothing about the others.
 */
export function clearPendingAttempts(
  reconnectAttempts: Map<string, ConnectionAttempt>,
  cancelRetry: (key: string) => void,
  reason: string,
): void {
  if (reconnectAttempts.size === 0) return;
  debugLog(
    'ServerAutoConnectService',
    `Clearing ${reconnectAttempts.size} pending reconnect attempt(s) after ${reason}`,
  );
  for (const key of [...reconnectAttempts.keys()]) cancelRetry(key);
}
