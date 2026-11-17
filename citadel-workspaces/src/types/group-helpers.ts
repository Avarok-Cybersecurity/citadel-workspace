/**
 * Group Helper Functions
 *
 * Utility functions for group permission checks, role resolution,
 * and member sorting.
 */

import type { GroupRole, GroupPermissions } from './group-permissions';
import type { GroupSettings, GroupMemberWithRole } from './group-entities';

/**
 * Check if a user can perform an action based on their role
 */
export function canPerformAction(
  userRole: GroupRole,
  action: keyof GroupPermissions
): boolean {
  return userRole.permissions[action];
}

/**
 * Check if a user can manage another user based on role hierarchy
 */
export function canManageUser(
  actorRole: GroupRole,
  targetRole: GroupRole
): boolean {
  return actorRole.position > targetRole.position;
}

/**
 * Get the owner role from a group's settings
 */
export function getOwnerRole(settings: GroupSettings): GroupRole | undefined {
  return settings.roles.find(r => r.isBuiltIn && r.position === 100);
}

/**
 * Get the default role for new members
 */
export function getDefaultRole(settings: GroupSettings): GroupRole | undefined {
  return settings.roles.find(r => r.isDefault);
}

/**
 * The role id a joining member should carry, given an id that may have come
 * from somewhere else.
 *
 * Role ids are minted per peer with `crypto.randomUUID()` (`createDefaultRoles`),
 * so an id that travelled from another peer's copy of a group names nothing
 * here. Stored anyway, it leaves a member whose role cannot be found, and
 * `useGroupPermissions` answers "no permissions" to that — a refusal
 * attributed to a role that does not exist. Prefer this group's own default
 * over keeping a reference that resolves to nothing.
 *
 * The last-resort role is the lowest-privilege one by array position rather
 * than a hard-coded index: `roles[2]` was correct only while there were
 * exactly three defaults, and would have started returning `undefined` — typed
 * `string` — the day one was added or removed.
 *
 * Returns null only when the group has no roles at all. There is no id to give
 * then, and inventing one is how a `roleId: string` comes to hold undefined.
 */
export function resolveRoleId(
  settings: GroupSettings,
  offered: string | undefined,
): string | null {
  if (offered !== undefined && settings.roles.some(r => r.id === offered)) return offered;
  const fallback: GroupRole | undefined =
    getDefaultRole(settings) ?? settings.roles[settings.roles.length - 1];
  return fallback ? fallback.id : null;
}

/**
 * Sort members: owner first, then by role position (desc), then alphabetical
 */
export function sortMembers(
  members: GroupMemberWithRole[]
): GroupMemberWithRole[] {
  return [...members].sort((a, b) => {
    if (a.role.position !== b.role.position) {
      return b.role.position - a.role.position;
    }
    return a.username.localeCompare(b.username);
  });
}
