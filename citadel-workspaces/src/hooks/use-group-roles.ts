/**
 * useGroupRoles Hook
 *
 * Manages roles for a specific group.
 * Handles role CRUD operations with hierarchy validation.
 */

import { useCallback, useMemo } from 'react';
import type {
  GroupRole,
  GroupSettings,
  GroupPermissions,
  GroupConversation,
} from '@/types/group';
import {
  DEFAULT_MEMBER_PERMISSIONS,
  canManageUser,
} from '@/types/group';
import { debugLog } from '@/lib/debug-config';
import type { UseGroupRolesResult } from './use-group-roles-types';

export function useGroupRoles(
  group: GroupConversation,
  onSettingsChange: (settings: GroupSettings) => void
): UseGroupRolesResult {
  const { settings } = group;
  const { roles } = settings;

  const sortedRoles: GroupRole[] = useMemo(() => {
    return [...roles].sort((a, b) => b.position - a.position);
  }, [roles]);

  const defaultRole: GroupRole | undefined = useMemo((): GroupRole | undefined => {
    return roles.find(r => r.isDefault);
  }, [roles]);

  const ownerRole: GroupRole | undefined = useMemo((): GroupRole | undefined => {
    return roles.find(r => r.isBuiltIn && r.position === 100);
  }, [roles]);

  const getRoleById: (roleId: string) => GroupRole | undefined = useCallback(
    (roleId: string): GroupRole | undefined => {
      return roles.find(r => r.id === roleId);
    },
    [roles]
  );

  const canManageRole: (actorRoleId: string, targetRoleId: string) => boolean = useCallback(
    (actorRoleId: string, targetRoleId: string): boolean => {
      const actorRole: GroupRole | undefined = getRoleById(actorRoleId);
      const targetRole: GroupRole | undefined = getRoleById(targetRoleId);

      if (!actorRole || !targetRole) return false;
      if (targetRole.isBuiltIn) return false;

      return canManageUser(actorRole, targetRole);
    },
    [getRoleById]
  );

  const validatePosition: (position: number, excludeRoleId?: string) => boolean = useCallback(
    (position: number, excludeRoleId?: string): boolean => {
      if (position < 1 || position > 99) return false;

      return !roles.some(
        r => r.position === position && r.id !== excludeRoleId
      );
    },
    [roles]
  );

  const suggestPosition: () => number = useCallback((): number => {
    const nonOwnerRoles: GroupRole[] = roles.filter(r => !r.isBuiltIn);
    if (nonOwnerRoles.length === 0) return 50;

    const lowestPosition: number = Math.min(...nonOwnerRoles.map(r => r.position));
    const suggested: number = Math.floor(lowestPosition / 2);

    return suggested > 0 ? suggested : 5;
  }, [roles]);

  const createRole: (name: string, position: number, permissions: GroupPermissions, color?: string) => GroupRole = useCallback(
    (
      name: string,
      position: number,
      permissions: GroupPermissions,
      color?: string
    ): GroupRole => {
      const newRole: GroupRole = {
        id: crypto.randomUUID(),
        name,
        position,
        color,
        permissions,
        isDefault: false,
        isBuiltIn: false,
      };

      const updatedSettings: GroupSettings = {
        ...settings,
        roles: [...roles, newRole],
      };

      onSettingsChange(updatedSettings);
      return newRole;
    },
    [roles, settings, onSettingsChange]
  );

  const updateRole: (roleId: string, updates: Partial<Omit<GroupRole, "id" | "isBuiltIn">>) => GroupSettings = useCallback(
    (
      roleId: string,
      updates: Partial<Omit<GroupRole, 'id' | 'isBuiltIn'>>
    ): GroupSettings => {
      const updatedRoles: GroupRole[] = roles.map(role => {
        if (role.id !== roleId) return role;

        if (role.isBuiltIn) {
          return {
            ...role,
            name: updates.name ?? role.name,
            color: updates.color ?? role.color,
          };
        }

        return { ...role, ...updates };
      });

      // Only one role may be default. Two things matter here beyond that.
      //
      // First, the map above returns the ORIGINAL object for every role it is
      // not editing, so assigning `r.isDefault = false` used to write straight
      // through to the caller's own array -- the settings the store holds, the
      // props a memoized child compared by reference, the copy already read
      // out of persistence. Those saw the flag flip with no state update to
      // announce it, and if `onSettingsChange` were rejected the write had
      // already happened. Build a new object for each role instead.
      //
      // Second, clear the others only when the target actually BECAME default.
      // A built-in role keeps everything but its name and colour, so asking to
      // make one default changes nothing about it -- clearing the rest on the
      // strength of the request alone would leave the group with no default
      // role at all, and `resolveRoleId` would start handing out whichever
      // role happens to sit last. The editor disables that checkbox for
      // built-in roles, so this is a guard on the hook's own contract rather
      // than a live path today.
      const target: GroupRole | undefined = updatedRoles.find(r => r.id === roleId);
      const becameDefault: boolean = updates.isDefault === true && target?.isDefault === true;
      const finalRoles: GroupRole[] = becameDefault
        ? updatedRoles.map(r => (r.id === roleId || !r.isDefault ? r : { ...r, isDefault: false }))
        : updatedRoles;

      const updatedSettings: GroupSettings = {
        ...settings,
        roles: finalRoles,
        defaultRoleId: becameDefault ? roleId : settings.defaultRoleId,
      };

      onSettingsChange(updatedSettings);
      return updatedSettings;
    },
    [roles, settings, onSettingsChange]
  );

  const deleteRole: (roleId: string) => GroupSettings = useCallback(
    (roleId: string): GroupSettings => {
      const roleToDelete: GroupRole | undefined = getRoleById(roleId);

      if (!roleToDelete || roleToDelete.isBuiltIn || roleToDelete.isDefault) {
        debugLog('UseGroupRoles', 'Cannot delete built-in or default role');
        return settings;
      }

      const updatedRoles: GroupRole[] = roles.filter(r => r.id !== roleId);

      const updatedSettings: GroupSettings = {
        ...settings,
        roles: updatedRoles,
      };

      onSettingsChange(updatedSettings);
      return updatedSettings;
    },
    [roles, settings, getRoleById, onSettingsChange]
  );

  const setDefaultRole: (roleId: string) => GroupSettings = useCallback(
    (roleId: string): GroupSettings => {
      const updatedRoles: { isDefault: boolean; id: string; name: string; position: number; color?: string; permissions: GroupPermissions; isBuiltIn: boolean; }[] = roles.map(role => ({
        ...role,
        isDefault: role.id === roleId,
      }));

      const updatedSettings: GroupSettings = {
        ...settings,
        roles: updatedRoles,
        defaultRoleId: roleId,
      };

      onSettingsChange(updatedSettings);
      return updatedSettings;
    },
    [roles, settings, onSettingsChange]
  );

  return {
    roles: sortedRoles,
    defaultRole,
    ownerRole,
    createRole,
    updateRole,
    deleteRole,
    setDefaultRole,
    getRoleById,
    canManageRole,
    validatePosition,
    suggestPosition,
  };
}

/**
 * Create default permissions for a new role
 */
export function createEmptyPermissions(): GroupPermissions {
  return { ...DEFAULT_MEMBER_PERMISSIONS };
}
