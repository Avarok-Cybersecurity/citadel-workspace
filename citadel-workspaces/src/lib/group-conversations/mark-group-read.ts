import type { GroupConversation } from '@/types/group';

/**
 * Clear a group's unread count, returning the SAME array when there is nothing
 * to clear.
 *
 * The identity is the whole point. `updateGroups` guards with `next === groups`
 * and nothing else, so an updater that always allocates notifies every
 * subscriber and fires an IndexedDB write on every call. The group page marks
 * read from an effect whose deps include `getGroup`, whose identity derives from
 * `groups` — so a fresh array restarted the effect, which called this again.
 * Opening any group chat was a perpetual render-and-write loop, ending either in
 * a hot tab or in React's "Maximum update depth exceeded".
 *
 * Extracted so the test exercises the real updater rather than a copy of it.
 */
export function markGroupRead(
  prev: GroupConversation[],
  groupId: string,
): GroupConversation[] {
  const target: GroupConversation | undefined = prev.find((group) => group.id === groupId);
  if (!target || target.unreadCount === 0) return prev;
  return prev.map((group) =>
    group.id === groupId ? { ...group, unreadCount: 0 } : group,
  );
}
