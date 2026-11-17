/**
 * useGroupPermissions Hook
 *
 * Checks permissions for the current user within a group.
 * Provides role-based access control for group operations.
 */

import { useMemo, useCallback } from 'react';
import { connectionManager } from '@/lib/connection';
import type {
  GroupConversation,
  GroupRole,
  GroupMember,
  GroupPermissions,
} from '@/types/group';
import { canManageUser } from '@/types/group';
import type { CurrentConnectionInfo } from '@/lib/connection/types';

// ============================================================================
// Types
// ============================================================================

interface UseGroupPermissionsResult {
  /** Current user's role in this group */
  myRole: GroupRole | undefined;
  /** Current user's member info */
  myMember: GroupMember | undefined;
  /** Whether current user is the group owner */
  isOwner: boolean;
  /** Whether current user is a group admin (has manageRoles permission) */
  isAdmin: boolean;
  /** Check if user can perform a specific action */
  can: (action: keyof GroupPermissions) => boolean;
  /** Check if user can manage a specific member */
  canManageMember: (memberCid: bigint) => boolean;
  /** Check if user can manage a specific role */
  canManageRole: (roleId: string) => boolean;
  /** Check if user can assign a specific role */
  canAssignRole: (roleId: string) => boolean;
  /** Get all permissions as a map for easy checking */
  permissions: GroupPermissions;
  /**
   * Whether the current user appears in this group's member list.
   *
   * `can(...)` answers false both for a role that denies and for a user who is
   * not listed at all, and those need different words on screen. See
   * components/chat/group-restriction.ts.
   */
  listedAsMember: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * `group` is nullable because the page that owns it renders a spinner until it
 * loads, and hooks cannot be called conditionally. A group nobody has loaded
 * yet grants nothing -- the same answer this hook already gives for a member
 * with no role.
 */
export function useGroupPermissions(
  group: GroupConversation | null
): UseGroupPermissionsResult {
  const connectionInfo: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
  const currentCid: bigint | undefined = connectionInfo?.cid;

  // Find current user's member info
  const myMember: GroupMember | undefined = useMemo((): GroupMember | undefined => {
    if (!currentCid || !group) return undefined;
    return group.members.find(m => m.cid === currentCid);
  }, [group, currentCid]);

  // Find current user's role
  const myRole: GroupRole | undefined = useMemo((): GroupRole | undefined => {
    if (!myMember || !group) return undefined;
    return group.settings.roles.find(r => r.id === myMember.roleId);
  }, [myMember, group]);

  // Check if owner
  const isOwner: boolean = useMemo((): boolean => {
    return group !== null && currentCid === group.ownerId;
  }, [currentCid, group]);

  // Check if admin (has manageRoles permission)
  const isAdmin: boolean = useMemo((): boolean => {
    if (!myRole) return false;
    return myRole.permissions.manageRoles || isOwner;
  }, [myRole, isOwner]);

  // Get permissions object (with owner override)
  const permissions: GroupPermissions = useMemo((): GroupPermissions => {
    if (isOwner) {
      // Owner has all permissions
      return {
        sendMessages: true,
        viewMemberList: true,
        inviteMembers: true,
        kickMembers: true,
        manageRoles: true,
        assignRoles: true,
        editGroupSettings: true,
        deleteGroup: true,
      };
    }

    if (!myRole) {
      // No role = no permissions
      return {
        sendMessages: false,
        viewMemberList: false,
        inviteMembers: false,
        kickMembers: false,
        manageRoles: false,
        assignRoles: false,
        editGroupSettings: false,
        deleteGroup: false,
      };
    }

    return myRole.permissions;
  }, [myRole, isOwner]);

  // Check if can perform action
  const can: (action: keyof GroupPermissions) => boolean = useCallback(
    (action: keyof GroupPermissions): boolean => {
      return permissions[action];
    },
    [permissions]
  );

  // Check if can manage a member
  const canManageMember: (memberCid: bigint) => boolean = useCallback(
    (memberCid: bigint): boolean => {
      if (!currentCid || memberCid === currentCid) return false; // Cannot manage self
      if (!myRole || !group) return false;
      if (!permissions.kickMembers && !permissions.assignRoles) return false;

      const targetMember: GroupMember | undefined = group.members.find(m => m.cid === memberCid);
      if (!targetMember) return false;

      const targetRole: GroupRole | undefined = group.settings.roles.find(r => r.id === targetMember.roleId);
      if (!targetRole) return false;

      // Check hierarchy
      return canManageUser(myRole, targetRole);
    },
    [currentCid, myRole, permissions, group]
  );

  // Check if can manage a role
  const canManageRole: (roleId: string) => boolean = useCallback(
    (roleId: string): boolean => {
      if (!myRole) return false;
      if (!permissions.manageRoles) return false;

      if (!group) return false;
      const targetRole: GroupRole | undefined = group.settings.roles.find(r => r.id === roleId);
      if (!targetRole) return false;

      // Cannot manage built-in roles
      if (targetRole.isBuiltIn) return false;

      // Check hierarchy
      return canManageUser(myRole, targetRole);
    },
    [myRole, permissions.manageRoles, group]
  );

  // Check if can assign a role
  const canAssignRole: (roleId: string) => boolean = useCallback(
    (roleId: string): boolean => {
      if (!myRole) return false;
      if (!permissions.assignRoles) return false;

      if (!group) return false;
      const targetRole: GroupRole | undefined = group.settings.roles.find(r => r.id === roleId);
      if (!targetRole) return false;

      // Can only assign roles below own position
      return myRole.position > targetRole.position;
    },
    [myRole, permissions.assignRoles, group]
  );

  return {
    myRole,
    myMember,
    isOwner,
    isAdmin,
    can,
    canManageMember,
    canManageRole,
    canAssignRole,
    permissions,
    listedAsMember: myMember !== undefined,
  };
}
