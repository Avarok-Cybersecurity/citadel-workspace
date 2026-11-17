import { eventEmitter } from '@/lib/event-emitter';
import { getGroups, updateGroups, resetGroupsForSession } from './group-store';
import type { GroupConversation } from '@/types/group';
import { debugLog } from '@/lib/debug-config';
import { groupIdToKey } from './group-key';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { requestJoinedGroups } from './learn-joined-groups';

/**
 * Making the sidebar agree with the server about which groups still exist.
 *
 * Every group event the UI handles is ADDITIVE or self-inflicted: a create you
 * performed, an invite you received, a deletion you were online to be told
 * about. The restore path is a union merge by design, so nothing has ever been
 * able to REMOVE a group the client did not watch disappear.
 *
 * So a group deleted while you were offline — or one you were kicked from
 * while offline, since both arrive as the same `GroupDisconnectNotification`
 * and neither is replayed on reconnect — stays in the sidebar permanently. It
 * survives reloads, because the restore reads it back out of IndexedDB and
 * merges it in again. Clicking it opens a chat whose sends the server drops.
 *
 * The server can answer this: `GroupListGroupsFor` exists, `sendGroupListRequest`
 * sends it, and `GroupListGroupsSuccess` carries the list. Three things were
 * missing. The response was mapped by nothing; `refresh()` had no caller in any
 * component; and even wired up, nothing would have removed anything, because
 * union merge is the only operation the store had.
 */

/**
 * The ids present when the outstanding list request was sent.
 *
 * Reconciling against "everything the client currently holds" would delete a
 * group created in the window between the request going out and the answer
 * coming back — the server's snapshot predates it, so its absence proves
 * nothing. Only ids that were already known when we asked can be judged by the
 * answer.
 *
 * Null means no request is outstanding, so an unsolicited or late list is
 * ignored rather than acted on: a stale snapshot is exactly the thing that
 * would delete a live group.
 */
let askedWith: Set<string> | null = null;

/**
 * Ask the server which groups this account is actually in.
 *
 * The request module is imported lazily, not at the top. It reaches the
 * WebSocket service, and the group store binds this module at startup — so a
 * static import would put the entire socket stack in the store's import graph,
 * which is how a unit test of an unread badge came to construct a
 * BroadcastChannel and die on an unrelated identity call.
 */
export async function requestGroupReconcile(): Promise<void> {
  const { sendGroupListRequest } = await import('./group-requests');
  askedWith = new Set(getGroups().map((g) => g.id));
  await sendGroupListRequest();
}

/**
 * Drop the groups the server did not list.
 *
 * Pure, and deliberately conservative in both directions: a group the server
 * lists but the client does not hold is NOT added here — the wire carries only
 * a group key, with no name, owner or roster, so a group built from one would
 * be a husk. Absence is the only fact a list can establish on its own.
 */
export function reconcileGroups(
  current: GroupConversation[],
  serverIds: readonly string[],
  knownWhenAsked: ReadonlySet<string>,
  selfCid: bigint | null,
): GroupConversation[] {
  const live: Set<string> = new Set(serverIds);
  const next: GroupConversation[] = current.filter(
    (g) => live.has(g.id) || !knownWhenAsked.has(g.id) || !weOwn(g.id, selfCid),
  );
  return next.length === current.length ? current : next;
}

/**
 * Whether this account is the group's OWNER, which is the only thing the server's answer
 * speaks about.
 *
 * The request behind `serverIds` is `list_owned_groups` — the SDK map is keyed by owner CID —
 * so a group somebody else created is never in it, whether it exists or not. Judging those by
 * absence deleted every group an invitee had been added to, from the sidebar AND from storage,
 * on every login and every reload: the one place this reconciliation could do real damage, and
 * the one case its evidence says nothing about.
 *
 * A group id is `<ownerCid>:<mgid>`. An id that will not parse is not judged either: it cannot
 * be attributed to anyone, and destroying what we cannot identify is the opposite of what this
 * function is for.
 */
function weOwn(groupId: string, selfCid: bigint | null): boolean {
  if (selfCid === null) return false;
  try {
    return groupIdToKey(groupId).cid === selfCid;
  } catch {
    return false;
  }
}

/** Apply a server list, if one was asked for. Idempotent; safe to call twice. */
export function applyGroupList(serverIds: readonly string[]): void {
  const asked: Set<string> | null = askedWith;
  if (!asked) return;
  askedWith = null;
  const selfCid: bigint | null = instanceManager.cid;
  updateGroups((prev) => reconcileGroups(prev, serverIds, asked, selfCid));
}

/**
 * Scope the list to the live account, then ask the server what it still holds.
 *
 * Failure is swallowed on purpose and is not silent-by-accident: if the socket
 * is not ready the request throws, no list arrives, and the sidebar keeps
 * showing what it showed before. The alternative, surfacing a toast for a
 * background consistency check nobody asked for, is worse.
 */
function reconcileSession(): void {
  // Scope first, then ask. The list is a module singleton keyed by nothing, so
  // without the reset the snapshot would be built from the PREVIOUS account's
  // groups -- or, on mount, before the persisted restore had put anything in it.
  void resetGroupsForSession()
    .then(() => requestGroupReconcile())
    .then(() => requestJoinedGroups())
    .catch((error: unknown) => {
      debugLog('GroupReconcile', 'Could not ask the server for the group list', error);
    });
}

export function bindGroupListReconcile(): void {
  eventEmitter.on('group:list-received', (data: { groupIds: string[] }) => {
    applyGroupList(data.groupIds);
  });

  // A session becoming live is the moment the answer can change AND the moment
  // it matters: everything that happened while this account was offline is
  // exactly what no event will ever tell it about.
  eventEmitter.on('instance:cid-changed', (data: { cid: bigint | null }) => {
    if (data.cid !== null) reconcileSession();
  });

  // ...but that event has almost always fired already. These bindings start
  // when the first group consumer MOUNTS, and sign-in and resume both set the
  // cid before the workspace renders; the cid is permanent, so `setCid` never
  // emits again. Listening alone meant the request was never sent in any
  // normal session, and groups the server had lost stayed in the sidebar
  // forever. A session that was live before we subscribed is reconciled now.
  if (instanceManager.cid !== null) reconcileSession();
}

/** Test seam: forget any outstanding request. */
export function resetGroupReconcileState(): void {
  askedWith = null;
}
