import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { isNewId } from '@/lib/seen-ids';
import { isOwnGroupMessage } from './own-message';
import { debugLog } from '@/lib/debug-config';
import type { GroupConversation } from '@/types/group';
import { isValidGroupId } from './group-key';
import { memberGroupRecord } from './member-group-record';

/** How much of a message the sidebar previews before eliding. */
const PREVIEW_CHARS: number = 50;

/**
 * Fold an incoming group message into the list.
 *
 * Pure, and separate from the store's bindings so the unread rule can be tested
 * without an event emitter — the rule is where the bug was. The server answers
 * the SENDER with the same GroupMessageNotification it broadcasts to everyone
 * else (that echo is what confirms a send), so counting every arrival as unread
 * meant sending three messages made your own badge read 3.
 *
 * Two guards its siblings carry and this did not (`apply-group-settings`,
 * `rename-group`, `mark-group-read`):
 *
 *   - A message for a group the store does not have must return `prev` -- unless
 *     it is a peer-group key, below. `map` always allocates, so an unknown group
 *     produced a fresh array, a store notification and an IndexedDB write for a
 *     change nobody made.
 *
 * A peer-group message for a group the store lacks CREATES it: the server
 * broadcasts only to members, so it is proof of membership, and it was the only
 * way a member's new browser could learn a group (reconcile-groups only
 * removes, from the OWNED list).
 *   - A message id is applied once. The transport redelivers, and a second
 *     arrival added another to the unread badge for a message already counted.
 */
export function applyGroupMessage(
  groups: GroupConversation[],
  data: { groupId: string; senderId: string; content: string; messageId?: string; groupName?: string; selfUsername?: string;
    /** The user is looking at this group now (see group-in-front): reading it is not leaving it unread. */
    viewing: boolean;
  },
  now: number,
  /** What the roster addresses a CID by; names the members of a group learnt here. */
  usernameFor: (cid: bigint) => string,
): GroupConversation[] {
  const known: boolean = groups.some((group) => group.id === data.groupId);
  // Nothing to fold into, and nothing that could be one. Returning `prev` is the store's no-op contract.
  if (!known && !isValidGroupId(data.groupId)) {
    debugLog('GroupStore', `Message for a group the store does not have: ${data.groupId}`);
    return groups;
  }

  // Applied once, however many times it arrives.
  //
  // Absent id means the emitter did not supply one; counting it is the old
  // behaviour and better than dropping a real message, so the guard only ever
  // REFUSES an id it has already seen.
  if (data.messageId !== undefined && !isNewId(`group:${data.groupId}`, data.messageId)) {
    debugLog('GroupStore', `Redelivered group message ${data.messageId}, not counted again`);
    return groups;
  }

  const own: bigint | null = instanceManager.cid;
  // By CID or username; an office channel names the sender by username (see own-message).
  const fromSelf: boolean = isOwnGroupMessage(data.senderId, { cid: own, username: data.selfUsername });
  const withGroup: GroupConversation[] = known ? groups : [...groups, memberGroupRecord({
    groupId: data.groupId, groupName: data.groupName, senderId: data.senderId, self: own, selfUsername: data.selfUsername, usernameFor,
  })];

  return withGroup.map((group) => {
    if (group.id !== data.groupId) return group;
    return {
      ...group,
      // Present only when the group's owner sent this message (see
      // peer-group-inbound): the wire's one way of telling members the name
      // the owner chose, which GroupCreate and GroupInvite cannot carry.
      name: data.groupName ?? group.name,
      unreadCount: fromSelf || data.viewing ? group.unreadCount : group.unreadCount + 1,
      lastMessageTime: now,
      lastMessagePreview:
        data.content.length > PREVIEW_CHARS
          ? data.content.substring(0, PREVIEW_CHARS) + '...'
          : data.content,
    };
  });
}
