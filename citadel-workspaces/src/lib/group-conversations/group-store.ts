/**
 * The one place group-conversation state lives.
 *
 * It used to live inside useGroupState — PER HOOK INSTANCE. The sidebar's
 * instance received the group events and built the list; the moment the user
 * navigated to /groups/:id, GroupChatPage mounted a FRESH instance whose list
 * was empty, concluded "Group not found", and bounced back to the workspace.
 * The localStorage "persistence" that was supposed to bridge instances never
 * once worked: member CIDs are bigint, JSON.stringify throws on bigint, and
 * the save was wrapped in a try/catch that logged and moved on — so every
 * instance always started from nothing. That dead persistence is removed
 * rather than patched with a bigint replacer (see the CID rules: browser
 * persistence belongs to IndexedDB, not JSON); state now simply lives for the
 * session, shared by every consumer.
 *
 * Event handling is bound here exactly once, not per hook instance — with a
 * shared list, per-instance handlers would apply every event N times (visible
 * immediately as unread counts climbing by the number of mounted components).
 */

import { eventEmitter } from '@/lib/event-emitter';
import { notifyEach } from '@/lib/notify-listeners';
import { bindMembershipEvents } from './group-membership-events';
import { chosenGroupName } from './group-names';
import { bindGroupFailureToasts } from './group-failure-toasts';
import { bindGroupRemovalNotice } from './group-removal-notice';
import { bindGroupListReconcile } from './reconcile-groups';
import { bindEndedGroups } from './ended-groups';
import { bindPeerGroupDelivery } from './bind-peer-group-delivery';
import { bindGroupTranscript } from './bind-group-transcript';
import { bindGroupReactions } from './group-reactions';
import type { GroupConversation } from '@/types/group';
import { createDefaultRoles, getDefaultRole } from '@/types/group';
import { bindGroupInvites } from './bind-group-invites';
import { bindGroupControl } from './bind-group-control';
import { bindJoinedGroups } from './learn-joined-groups';
import { forgetPendingInvites, restorePendingInvites } from './group-invites';
import { loadPersistedGroups, persistGroups } from './group-persistence';
import { applyGroupMessage } from './apply-group-message';
import { groupInFront } from './group-in-front';
import { usernameFrom } from './member-group-record';
import { debugLog } from '@/lib/debug-config';
import type { GroupRole } from '@/types/group-permissions';

let groups: GroupConversation[] = [];
const listeners: Set<() => void> = new Set<() => void>();
let bindingsStarted: boolean = false;

let hydrated: boolean = false;

export function getGroups(): GroupConversation[] {
  return groups;
}

export function subscribeToGroups(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateGroups(
  updater: (prev: GroupConversation[]) => GroupConversation[],
): void {
  const next: GroupConversation[] = updater(groups);
  if (next === groups) return;
  groups = next;
  notifyEach(listeners, 'group-store');
  // Fire and forget: a storage failure must not block a state update the user
  // can already see. persistGroups logs and swallows for the same reason.
  void persistGroups(groups);
}

/**
 * Restore the previous session's groups.
 *
 * Without this the store was memory-only and nothing rebuilt it, so every
 * reload emptied the sidebar and a bookmarked /groups/:id reported "This group
 * may have been deleted" for a group that still existed.
 *
 * Restored groups are MERGED under whatever has arrived live, not assigned over
 * it: bindings are started before this resolves, so an invite that lands during
 * the read must not be overwritten by a snapshot taken before it.
 */
export async function restorePersistedGroups(): Promise<void> {
  void restorePendingInvites();
  try {
    const stored: GroupConversation[] = await loadPersistedGroups();
    if (stored.length > 0) {
      updateGroups((prev) => {
        const known: Set<string> = new Set(prev.map((g) => g.id));
        const missing: GroupConversation[] = stored.filter((g) => !known.has(g.id));
        return missing.length === 0 ? prev : [...prev, ...missing];
      });
    }
    // Anything that arrived BEFORE the read completed was held in memory but
    // not written: persistGroups refuses to write a key it has not read, since
    // at that point an empty list is indistinguishable from a lost one. Now
    // that the read has happened, flush what we hold.
    //
    // Inside the try, after the merge, so it runs only when the read actually
    // succeeded -- persistGroups would refuse anyway, but doing it here says
    // why rather than relying on the refusal.
    if (groups.length > 0) void persistGroups(groups);
  } finally {
    // Marked even when the read finds nothing or fails. "Hydration finished"
    // and "there are groups" are different facts, and a consumer waiting on the
    // first would wait forever if only the second set it.
    hydrated = true;
    notifyEach(listeners, 'group-store');
  }
}

/**
 * Forget this account's groups and load the next one's.
 *
 * The list is a module singleton and the restore is a union merge, so switching
 * accounts in one browser left the previous account's groups in the sidebar and
 * merged the new account's on top — two people's groups in one list, with the
 * first account's still clickable. Persistence was already keyed per CID; only
 * the memory in front of it was not.
 *
 * The clear does NOT go through `updateGroups`, which persists: writing an
 * empty list under the NEW account's key would destroy the very groups the
 * restore is about to read.
 */
export async function resetGroupsForSession(): Promise<void> {
  groups = [];
  forgetPendingInvites();
  hydrated = false;
  notifyEach(listeners, 'group-store');
  await restorePersistedGroups();
}

/**
 * Whether the persisted restore has finished.
 *
 * The restore above is asynchronous, and `getGroups()` reads the store
 * synchronously — so a page that mounts, looks up its group and finds nothing
 * has learned only that IndexedDB has not answered yet. GroupChatPage did
 * exactly that and concluded the group was deleted: every reload, bookmark and
 * shared `/groups/:id` link bounced to the workspace with a destructive toast,
 * deterministically, because all effects of a commit run before any microtask
 * from that read can resolve.
 *
 * The persistence layer was added to fix precisely this — its own comment says
 * so — but nothing ever waited for it.
 */
export function areGroupsHydrated(): boolean {
  return hydrated;
}

/**
 * Bind the group:* events to the store. Idempotent — every consumer calls it
 * on mount, only the first call subscribes.
 *
 * `selfUsername` reads the signed-in account's username: an office channel names the sender by
 * it, and a message of your own must not raise your badge (see own-message).
 */
export function startGroupEventBindings(selfUsername: () => string | undefined): void {
  if (bindingsStarted) return;
  bindingsStarted = true;

  bindGroupFailureToasts();
  bindGroupRemovalNotice((id: string): string | undefined => groups.find(g => g.id === id)?.name);
  bindMembershipEvents();

  eventEmitter.on('group:created', (data: {
    groupId: string;
    name: string;
    ownerId: string;
    ownerUsername: string;
  }) => {
    debugLog('GroupStore', 'Group created:', data);
    const defaultRoles: GroupRole[] = createDefaultRoles();
    const defaultRole: GroupRole | undefined = getDefaultRole({ roles: defaultRoles, defaultRoleId: '' });

    const newGroup: GroupConversation = {
      id: data.groupId,
      // What the creator typed, if this tab is where they typed it. The wire
      // has no name field, so `data.name` is always empty and the owner's
      // username is the fallback -- which is what the sidebar showed for a
      // group somebody had just named something else.
      name: chosenGroupName(data.groupId) ?? (data.name || data.ownerUsername),
      ownerId: BigInt(data.ownerId),
      members: [
        {
          cid: BigInt(data.ownerId),
          username: data.ownerUsername,
          roleId: defaultRoles[0].id,
          joinedAt: Date.now(),
        },
      ],
      settings: {
        roles: defaultRoles,
        defaultRoleId: defaultRole?.id || defaultRoles[defaultRoles.length - 1].id,
      },
      unreadCount: 0,
    };

    // By id, not unconditionally: accepting an invite can surface a channel
    // create for a group the invite already added, and a second row for the
    // same id would let the two drift apart.
    updateGroups(prev => (prev.some(g => g.id === newGroup.id) ? prev : [...prev, newGroup]));
  });

  // Held for an answer, not accepted; see bind-group-invites.
  bindGroupInvites((id: string): boolean => groups.some(g => g.id === id));

  eventEmitter.on('group:message-received', (data: {
    groupId: string;
    messageId?: string;
    senderId: string;
    content: string;
    groupName?: string;
    selfUsername?: string;
    memberUsernames?: Record<string, string>;
  }) => {
    updateGroups((prev) => applyGroupMessage(prev, { ...data, selfUsername: data.selfUsername ?? selfUsername(), viewing: groupInFront(data.groupId) }, Date.now(), usernameFrom(data.memberUsernames)));
  });

  eventEmitter.on('group:deleted', (data: { groupId: string }) => {
    debugLog('GroupStore', 'Group deleted:', data);
    updateGroups(prev => prev.filter(g => g.id !== data.groupId));
  });

  bindGroupListReconcile();
  bindEndedGroups();
  // After bindMembershipEvents, so an owner's snapshot lists the member who just joined.
  bindGroupControl();
  bindJoinedGroups();
  // A peer-group message reaches the sidebar through the event above; this is
  // what puts it in the conversation you are looking at. See the module header
  // for why it is bound here rather than for every group.
  bindPeerGroupDelivery();
  // And what keeps it there across a reload; see bind-group-transcript.
  bindGroupTranscript();
  bindGroupReactions();

  debugLog('GroupStore', 'Group event bindings started');
}
