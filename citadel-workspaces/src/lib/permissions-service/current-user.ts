/**
 * Who the permissions service is asking on behalf of.
 *
 * Two sources, and they are not interchangeable. `currentConnectionInfo.username`
 * is synchronous and is what the event listeners compare against when a
 * `UserPermissions` response arrives — an async lookup there would make the
 * answer depend on listener order. It is also empty for a user who logged IN
 * rather than registering, and was being erased outright by a partial write
 * until round 300.
 *
 * The tab-selected session is the authoritative record of who is signed in
 * here, and it is IndexedDB-backed, so it can only be had asynchronously.
 *
 * When the synchronous one returns null and nothing falls back, every fetch
 * bails with "No current user" — the cache stays empty, a check against an
 * unloaded domain returns false, and EVERY gate in the app denies. A workspace's
 * own admin then sees what a stranger sees, with nothing above debug level to
 * say why.
 *
 * Its own module because it is the question four rounds of CI archaeology kept
 * coming back to, and because it can be read without the rest of the service.
 */

import { connectionManager } from '@/lib/connection';
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import type { StoredSession } from '@/types/session-types';
import type { CurrentConnectionInfo } from '@/lib/connection/types';

/** The signed-in user as the connection knows them, without waiting. */
export function currentUserIdSync(): string | null {
  const connectionInfo: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
  return connectionInfo?.username || null;
}

/** The signed-in user, from whichever source actually knows. */
export async function resolveCurrentUserId(): Promise<string | null> {
  const fromConnection: string | null = currentUserIdSync();
  if (fromConnection) return fromConnection;

  // The SELECTION, before the session it points at.
  //
  // This went straight to `getTabSelectedSession`, which reads the selection
  // and then calls `findSession(username, serverAddress)` — so it answers
  // "which saved account is this tab using", and returns null when there is no
  // stored record to find. A username is a much smaller question, and the
  // selection already carries it.
  //
  // The difference is not hypothetical: stored sessions hold saved credentials,
  // so a user who declined to save them, or whose store has not loaded yet, has
  // a perfectly good selection and no session to match it. Every permission
  // fetch then bails with "nobody is signed in on this tab" — the sentence CI
  // kept returning on the workspace admin's own Edit button, through three
  // rounds of fixes to how and when the selection gets WRITTEN, while the thing
  // reading it back was asking for something else entirely.
  const tab: TabUserContext | null = await getSelectedUser();
  if (tab?.selectedUsername) return tab.selectedUsername;

  const session: StoredSession | null = await connectionManager.getTabSelectedSession();
  return session?.username ?? null;
}
