/**
 * The subscriber that was missing.
 *
 * `use-group-state` waits on six group:* events; nothing emitted them, and
 * GroupCreateSuccess was handled nowhere. createGroup fired its request, the
 * response fell on the floor, and the sidebar's group list stayed empty
 * forever — the Create Group dialog submitted, closed, and produced nothing.
 *
 * This listens to the same 'websocket-message' stream the peer-registration
 * store uses, maps each group response with the pure `toGroupEvents`, and emits.
 * All the mapping decisions live there; this is the shell that does the I/O.
 */

import { eventEmitter } from '../event-emitter';
import { connectionManager } from '../connection';
import type { StoredSession } from '@/types/session-types';
import { getSelectedUser } from '../tab-context';
import { isForThisSession, notificationCid } from '@/lib/sessions/notification-ownership';
import { debugLog } from '@/lib/debug-config';
import { toGroupEvents } from './group-events';
import { withoutAppTopics } from './app-topic-filter';
import { appTopicGroups } from './app-topic-groups';
import { rosterPeerName, rosterPeerUsername } from '@/lib/roster-peer-name';
import { memberUsernamesFor, usernamesOf } from './member-group-record';
import { groupIdToKey, isValidGroupId } from './group-key';
import type { GroupEvent } from './group-events';
import type { GroupControlBody } from './group-control-codec';
import type { TabUserContext } from '@/lib/tab-context';

let started: boolean = false;

/** Exported for its test: the fallback chain is the thing under test. */
export async function resolveSelfForTest(): Promise<{ cid: bigint; username: string } | null> {
  return resolveSelf();
}

/**
 * The stored-session username, once per cid.
 *
 * No clear() seam: a username does not change while the tab lives, and the
 * tests reset the module instead. An export nothing calls is the thing
 * `unreferenced exports` is there to stop, and it caught this one.
 */
const fallbackUsernames: Map<bigint, string> = new Map<bigint, string>();

async function resolveSelf(): Promise<{ cid: bigint; username: string } | null> {
  const cid: bigint | undefined = connectionManager.getConnectionInfo()?.cid;
  if (cid === undefined || cid === null) return null;

  const tab: TabUserContext | null = await getSelectedUser();
  const selected: string | undefined = tab?.selectedUsername;
  if (selected) return { cid, username: selected };

  // An empty username is not a name, and it reaches the screen. CI shows
  // `Group created: {name: , ownerId: ..., ownerUsername: }` on the CREATOR's
  // own page: `group:created` falls back to `ownerUsername` for the label, so
  // a group the user had just named appeared in their sidebar with no name at
  // all.
  //
  // The tab's stored session, not `getConnectionInfo().username`. That one
  // belongs to the CONNECTION rather than to this tab and is wrong whenever a
  // browser holds two sessions -- which is the priority rule
  // `check-one-answer-to-who-am-i` exists to keep.
  //
  // Memoised per cid, and that is not an optimisation. `getTabSelectedSession`
  // calls `getSelectedUser` AGAIN -- the call five lines above -- and, since
  // the username is still missing, goes on to read the active session index
  // too. Unmemoised, that is two storage reads for EVERY websocket message on
  // the path that handles every websocket message. A username does not change
  // within a session, so it is asked once.
  const cached: string | undefined = fallbackUsernames.get(cid);
  if (cached !== undefined) return { cid, username: cached };

  const session: StoredSession | null = await connectionManager.getTabSelectedSession();
  const username: string = session?.username ?? '';
  fallbackUsernames.set(cid, username);
  return { cid, username };
}

/**
 * Begin translating group responses into UI events. Idempotent — a second call
 * is a no-op rather than a second subscription, which would double every event.
 */
/**
 * Names the store will need, resolved here where the roster is: the store's own
 * import graph stays clear of the registration service (see reconcile-groups).
 */
function withResolvedNames(event: GroupEvent, selfUsername: string): Record<string, unknown> {
  switch (event.name) {
    case 'group:message-received':
      return { ...event.payload, memberUsernames: memberUsernamesFor(event.payload, rosterPeerUsername) };
    case 'group:control-received': {
      const control: GroupControlBody | undefined = event.payload.control as GroupControlBody | undefined;
      return { ...event.payload, memberUsernames: usernamesOf((control?.assignments ?? []).map((a) => a.cid), rosterPeerUsername) };
    }
    case 'group:joined-list-received': {
      const ids: string[] = (event.payload.groupIds as string[]).filter(isValidGroupId);
      return { ...event.payload, selfUsername, memberUsernames: usernamesOf(ids.map((id) => groupIdToKey(id).cid), rosterPeerUsername) };
    }
    default:
      return event.payload;
  }
}

export function startGroupResponseService(): void {
  if (started) return;
  started = true;

  eventEmitter.on('websocket-message', (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const message: Record<string, unknown> = raw as Record<string, unknown>;

    void (async (): Promise<void> => {
      const self: { cid: bigint; username: string; } | null = await resolveSelf();
      if (!self) return;

      // Addressed to THIS tab's session, or not ours to act on.
      //
      // The router has three documented paths that hand a notification to a tab
      // that does not own its cid (the 2s orphan buffer, the un-acked forward
      // fallback, and a stale instance registry). `group:invite-received` is
      // AUTO-ACCEPTED downstream, and the accept is sent under this tab's own
      // cid -- so an invitation addressed to account B, landing here, made
      // account A join a group it was never invited to, while B never saw the
      // invitation at all.
      //
      // A cid of null means the message names no session (a proxied
      // request/response, or a deliberate fan-out) and is not filtered here --
      // the same rule `notificationCid` documents for the legacy broadcast
      // path, which already had this guard and was never propagated to this one.
      const addressedTo: bigint | null = notificationCid(message);
      if (addressedTo !== null && !isForThisSession(addressedTo, self.cid)) {
        debugLog('GroupResponseService', `Ignoring a group response addressed to session ${String(addressedTo)}; this tab is ${String(self.cid)}`);
        return;
      }

      // The wire names peers only by CID; the registration roster is the one
      // authority for their names, asked the same way calls ask it. The
      // fallback for a peer the roster has not loaded is a short handle --
      // non-empty on purpose, because an invite whose inviter has no name at
      // all is dropped as malformed. It used to be `cid.toString()`, which is
      // how an invitee's group came to be titled "<twenty digits>'s Group" and
      // every member's message signed with the same twenty digits.
      // App topics are the app host's groups, never conversations (app-topic-filter.ts).
      for (const event of withoutAppTopics(toGroupEvents(message, self.cid, self.username, rosterPeerName), appTopicGroups)) {
        // A message can bring a group this browser has never seen; see member-group-record.
        const payload: Record<string, unknown> = withResolvedNames(event, self.username);
        debugLog('GroupResponseService', `${event.name}`, payload);
        eventEmitter.emit(event.name, payload);
      }
    })().catch((error) => {
      // `void` alone marks the promise handled for lint but does NOT catch —
      // a malformed group key throws by design, and unhandled it would surface
      // as an unhandled rejection rather than a log line.
      debugLog('GroupResponseService', 'Failed to handle a group response', error);
    });
  });

  debugLog('GroupResponseService', 'Listening for group responses');
}
