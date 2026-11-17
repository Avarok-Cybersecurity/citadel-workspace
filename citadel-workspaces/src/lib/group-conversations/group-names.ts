import { groupIdToKey, isValidGroupId } from './group-key';
import type { GroupConversation } from '@/types/group';

/**
 * The name the creator typed, kept where the protocol cannot keep it.
 *
 * `GroupCreate` carries `{cid, request_id, initial_users_to_invite}` and no
 * name, so `createGroup(name, members)` passed only the members on and dropped
 * the rest. The dialog asks for a group name, the user types one, and it went
 * nowhere: `group:created` sets `name: ''` with a comment saying the creator's
 * own username stands in.
 *
 * So the sidebar showed the creator's username for a group they had just named
 * something else -- and `peer-group`'s fallback, which looks for a row reading
 * the name it typed, could never match.
 *
 * The creator's own record keeps it here. Members learn it from the owner's
 * messages instead: the peer-group envelope is the one payload the two ends
 * define themselves, so it carries the name -- see `ownerAnnouncedName`.
 */
const chosen: Map<string, string> = new Map<string, string>();

/** Remember what the creator called this group. */
export function rememberGroupName(groupId: string, name: string): void {
  const trimmed: string = name.trim();
  if (trimmed.length === 0) return;
  chosen.set(groupId, trimmed);
}

/** Drop every remembered name. For tests; production never un-names a group. */
export function forgetGroupNames(): void {
  chosen.clear();
}

/** The chosen name, or null if this group was not named here. */
export function chosenGroupName(groupId: string): string | null {
  return chosen.get(groupId) ?? null;
}

/** Test seam: the map outlives a component, so a test has to be able to clear it. */
export function forgetChosenNames(): void {
  chosen.clear();
}

/**
 * The name an outgoing peer-group message tells the members, if any.
 *
 * Only the owner announces: the receiver honours a name only from the cid the
 * group key names as owner, and a member's local rename is theirs alone.
 * Decided by the key rather than `ownerId`, because the key is what the
 * receiving side checks.
 */
export function ownerAnnouncedName(group: GroupConversation | undefined, selfCid: bigint): string | undefined {
  if (!group || !isValidGroupId(group.id)) return undefined;
  if (groupIdToKey(group.id).cid !== selfCid) return undefined;
  const name: string = group.name.trim();
  return name.length > 0 ? name : undefined;
}
