/**
 * Types for useGroupRoles hook.
 */

import type {
  GroupRole,
  GroupSettings,
  GroupPermissions,
} from '@/types/group';

export interface UseGroupRolesResult {
  /** All roles in this group, sorted by position (highest first) */
  roles: GroupRole[];
  /** The default role for new members */
  defaultRole: GroupRole | undefined;
  /** The owner role */
  ownerRole: GroupRole | undefined;
  /** Create a new role */
  createRole: (
    name: string,
    position: number,
    permissions: GroupPermissions,
    color?: string
  ) => GroupRole;
  /** Update an existing role */
  updateRole: (roleId: string, updates: Partial<Omit<GroupRole, 'id' | 'isBuiltIn'>>) => GroupSettings;
  /** Delete a role (cannot delete built-in or default roles) */
  deleteRole: (roleId: string) => GroupSettings;
  /** Set the default role for new members */
  setDefaultRole: (roleId: string) => GroupSettings;
  /** Get role by ID */
  getRoleById: (roleId: string) => GroupRole | undefined;
  /** Check if a role can be managed by another role */
  canManageRole: (actorRoleId: string, targetRoleId: string) => boolean;
  /** Validate that a position is unique and within range */
  validatePosition: (position: number, excludeRoleId?: string) => boolean;
  /** Get the next available position for a new role */
  suggestPosition: () => number;
}
