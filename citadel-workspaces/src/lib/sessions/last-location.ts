/**
 * Where a session was when its user last left it.
 *
 * An in-tab refresh keeps its place, because the URL is the state
 * (`?nodeId`, `?channel`). The actual second-session path does not: landing
 * page → Active Sessions → claim navigates to the workspace root with no
 * params, so a user who closed the browser mid-conversation comes back
 * tomorrow, claims their session, and lands on the default office. They
 * re-find the conversation by hand, every day.
 *
 * Stored per CID beside `last-accessed`, which already records WHEN each
 * session was used and never recorded where.
 *
 * Only in-workspace locations are kept. Remembering `/connect` or the landing
 * page would send a returning user back to the screen they were trying to get
 * past — the one place a "restore where you were" feature must not take them.
 */

import { debugLog } from '@/lib/debug-config';

function keyFor(cid: bigint | string): string {
  return `session_last_location_${cid.toString()}`;
}

/** Paths that are somewhere in the app, as opposed to a way into it. */
const RESTORABLE: RegExp[] = [/^\/workspace\b/, /^\/messages\b/, /^\/files\b/, /^\/directory\b/];

export function isRestorableLocation(path: string): boolean {
  return RESTORABLE.some((pattern) => pattern.test(path));
}

export function rememberLocation(cid: bigint | string, path: string): void {
  if (!isRestorableLocation(path)) return;
  try {
    localStorage.setItem(keyFor(cid), path);
  } catch (error) {
    // Private mode or a full store. Forgetting where somebody was costs them a
    // click; failing the navigation costs them the session.
    debugLog('LastLocation', 'could not record location:', error);
  }
}

/** Where this session was, or null when there is nothing to go back to. */
export function readLastLocation(cid: bigint | string): string | null {
  try {
    const stored: string | null = localStorage.getItem(keyFor(cid));
    // Re-checked on the way out as well as in: a value written by an older
    // build, or by hand, must not become a navigation target.
    return stored && isRestorableLocation(stored) ? stored : null;
  } catch {
    return null;
  }
}
