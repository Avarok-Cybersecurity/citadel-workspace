/**
 * The two member lists a group page derives, and why each excludes somebody.
 *
 * Both were inline `useMemo`s in `GroupChatPage`, which the length cap pushed
 * out. They belong together: each answers "who is NOT in this list", and each
 * gets it wrong in a way the other explains.
 */
import type { GroupConversation } from '@/types/group';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';

export interface CallMember {
  cid: bigint;
  username: string;
}

/**
 * Everyone except the current user.
 *
 * `startCall` invites this exact list, so including ourselves makes the engine
 * ring us in our own call. `currentUserId` is empty when the tab cannot name
 * its connection, and then this excludes nobody — which is why the page
 * withholds the call controls entirely in that state rather than offering a
 * call that would ring the caller.
 */
export function callMembers(
  group: GroupConversation | null,
  currentUserId: string,
): CallMember[] {
  if (!group) return [];
  return group.members
    .filter((m) => m.cid.toString() !== currentUserId)
    .map((m) => ({ cid: m.cid, username: m.username }));
}

/**
 * Registered peers who are not already in the group.
 *
 * Anyone already in it would be a no-op invite, offered and then silently
 * rejected by the backend.
 */
export function invitablePeers(
  group: GroupConversation | null,
  registeredPeers: RegisteredPeer[],
): RegisteredPeer[] {
  if (!group) return [];
  const existing: Set<string> = new Set(group.members.map((m) => m.cid.toString()));
  return registeredPeers.filter((p) => !existing.has(p.cid));
}
