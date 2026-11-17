/**
 * Giving a member a role, in the store and to the other members.
 *
 * This was `updateMemberRole` in use-group-conversations, commented "local only
 * for now": the assignment reached this device's store and nobody else's, so
 * promoting someone to Admin made them an admin on your screen alone -- theirs,
 * and every other member's, went on judging them by the old role.
 *
 * Sibling of rename-group and apply-group-settings, with the same shape: the
 * store first, then announce-group-state, only when something changed.
 */
import type { GroupConversation } from '@/types/group';
import { getGroups, updateGroups } from './group-store';
import { announceGroupState } from './announce-group-state';

export function assignGroupRole(groupId: string, memberCid: bigint, roleId: string): void {
  let changed: boolean = false;
  updateGroups((prev: GroupConversation[]) => {
    const target: GroupConversation | undefined = prev.find((group) => group.id === groupId);
    // A role this group does not define would be a member with no permissions at all.
    if (!target || !target.settings.roles.some((role) => role.id === roleId)) return prev;
    if (!target.members.some((member) => member.cid === memberCid && member.roleId !== roleId)) return prev;
    changed = true;
    return prev.map((group) => (group.id !== groupId ? group : {
      ...group,
      members: group.members.map((member) => (member.cid === memberCid ? { ...member, roleId } : member)),
    }));
  });
  if (changed) announceGroupState(getGroups().find((group) => group.id === groupId));
}
