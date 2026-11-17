/**
 * Server Auto-Connect Service - Persistence
 *
 * LocalDB load/save for enabled setting and user-disconnected sessions.
 */

import { websocketService } from '@/lib/websocket-service';
import { stringToBytes, bytesToString } from '@/lib/utils/encoding-utils';
import { debugLog } from '@/lib/debug-config';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { GLOBAL_CID, LOCALDB_KEY, USER_DISCONNECTED_KEY } from './types';

/**
 * Load the enabled setting from LocalDB.
 *
 * Absent means nobody has chosen yet, and `true` is the documented default.
 * A FAILED read means nothing at all -- and returning the default there is how
 * a user who turned auto-connect off finds it back on after one timed-out
 * request. The two were one `catch` returning `true`, and the absent case fires
 * on every first boot, so the log line was permanent noise that nobody could
 * have read a real failure out of.
 */
export async function loadEnabledSetting(): Promise<boolean> {
  try {
    const result: { value: number[]; } | null = await websocketService.sendLocalDBGet(GLOBAL_CID, LOCALDB_KEY);
    if (result?.value) {
      const decoded: string = bytesToString(result.value);
      return decoded === 'true';
    }
  } catch (error) {
    if (isGenuinelyAbsent(error)) {
      debugLog('ServerAutoConnectService', 'No stored preference; auto-connect defaults to on');
      return true;
    }
    // Rethrown, not defaulted.
    //
    // The paragraph above this function already said what should happen here --
    // "returning the default there is how a user who turned auto-connect off
    // finds it back on after one timed-out request" -- and the code returned
    // `true` anyway. The predicate was imported, the distinction was drawn in
    // the log message, and the BEHAVIOUR was identical on both branches. That
    // is the shape of a fix that was written down and never applied.
    throw error;
  }
  return true;
}

/**
 * Save the enabled setting to LocalDB.
 */
export async function saveEnabledSetting(enabled: boolean): Promise<void> {
  const value: number[] = stringToBytes(String(enabled));
  await websocketService.sendLocalDBSet(GLOBAL_CID, LOCALDB_KEY, value);
  debugLog('ServerAutoConnectService', `Setting saved (enabled: ${enabled})`);
}

/**
 * Load user-disconnected sessions from LocalDB.
 * These are sessions the user explicitly signed out from.
 */
/**
 * Whether the sign-out record has actually been read.
 *
 * `persistUserDisconnectedSessions` writes the WHOLE set. That is sound only
 * when the set in memory came from the key -- and `loadAutoConnectSettings`
 * returns an EMPTY set with `initialized: false` when the read fails, while
 * the three writers never consult that flag. Only `getEnabled` did.
 *
 * So: boot, the LocalDB read times out, the set is empty. The user signs out
 * of A. `{A@srv}` is written over the stored `{B@srv, C@srv}`. On the next
 * boot B and C are auto-reconnected -- sessions the user deliberately signed
 * out of, silently, which this module's own header calls "neither visible nor
 * recoverable".
 *
 * Seventh site of this mechanism, and the guard is where the other six are:
 * on the one function every write funnels through. Three callers across two
 * modules reach it, so guarding the two in the service would have covered two
 * of three -- which is the defect, not the fix.
 */
let disconnectedSetWasRead: boolean = false;

/** For tests: forget the read, so a scenario starts cold. */
export function resetDisconnectedReadTracking(): void {
  disconnectedSetWasRead = false;
}

export async function loadUserDisconnectedSessions(): Promise<Set<string>> {
  try {
    const result: { value: number[]; } | null = await websocketService.sendLocalDBGet(GLOBAL_CID, USER_DISCONNECTED_KEY);
    disconnectedSetWasRead = true;
    if (result?.value) {
      const decoded: string = bytesToString(result.value);
      const sessions: unknown = JSON.parse(decoded);
      if (Array.isArray(sessions)) {
        debugLog('ServerAutoConnectService', `Loaded ${sessions.length} user-disconnected sessions from LocalDB`);
        return new Set(sessions);
      }
    }
  } catch (error) {
    if (isGenuinelyAbsent(error)) {
      debugLog('ServerAutoConnectService', 'No user-disconnected sessions stored yet');
      // A key that holds nothing is a complete picture of nothing, so the
      // first sign-out must still be recordable.
      disconnectedSetWasRead = true;
      return new Set<string>();
    }
    // Rethrown for the reason the old comment gave: an empty set here means
    // "nobody signed out of anything", which is exactly what makes the service
    // reconnect a session the user deliberately signed out of.
    throw error;
  }
  return new Set();
}

/**
 * Persist user-disconnected sessions to LocalDB.
 */
export async function persistUserDisconnectedSessions(sessions: Set<string>): Promise<void> {
  if (!disconnectedSetWasRead) {
    // Refusing keeps the stored record intact for the next attempt. Writing
    // an unread set would erase every other session's sign-out, and the user
    // would discover it by being signed back in to an account they left.
    debugLog(
      'ServerAutoConnectService',
      'Refusing to write the user-disconnected set: it was never successfully read',
    );
    return;
  }
  try {
    const value: number[] = stringToBytes(JSON.stringify(Array.from(sessions)));
    await websocketService.sendLocalDBSet(GLOBAL_CID, USER_DISCONNECTED_KEY, value);
  } catch (error) {
    debugLog('ServerAutoConnectService', 'Failed to persist user disconnected sessions:', error);
  }
}
