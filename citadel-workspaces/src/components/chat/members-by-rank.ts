/**
 * Members with their roles resolved, ranked highest role first then by name.
 *
 * This exact loop-and-sort was written out three times -- the chat header's
 * avatar strip, the settings roster and the sidebar row -- which is three
 * places to keep in step and three places for the ordering to drift apart.
 *
 * Members whose `roleId` matches no role in the group are dropped rather than
 * rendered rankless: a role that is not in `settings.roles` carries no
 * permissions, so there is nothing truthful to show for it.
 */
import type { GroupConversation, GroupMemberWithRole } from '@/types/group';
import type { GroupRole } from '@/types/group-permissions';

/**
 * Roles that can be handed to somebody, highest first.
 *
 * Built-in roles are excluded: the owner role in particular is not assignable,
 * and offering it in a dropdown that silently rejects it is worse than not
 * offering it.
 */
export function assignableRoles(group: GroupConversation): GroupRole[] {
  return group.settings.roles
    .filter(r => !r.isBuiltIn)
    .sort((a, b) => b.position - a.position);
}

export function membersByRank(group: GroupConversation): GroupMemberWithRole[] {
  return [...group.members]
    .flatMap((member): GroupMemberWithRole[] => {
      const role: GroupRole | undefined = group.settings.roles.find(r => r.id === member.roleId);
      if (!role) return [];
      return [{ ...member, role } as GroupMemberWithRole];
    })
    .sort((a, b) => {
      if (a.role.position !== b.role.position) {
        return b.role.position - a.role.position;
      }
      return a.username.localeCompare(b.username);
    });
}
