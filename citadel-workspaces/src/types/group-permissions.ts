/**
 * Group Permissions & Roles
 *
 * Permission definitions and role types for group chats.
 * Discord-like role system separate from workspace/office/room permissions.
 */

// ============================================================================
// Permissions
// ============================================================================

export interface GroupPermissions {
  sendMessages: boolean;
  viewMemberList: boolean;
  inviteMembers: boolean;
  kickMembers: boolean;
  manageRoles: boolean;
  assignRoles: boolean;
  editGroupSettings: boolean;
  deleteGroup: boolean;
}

export const DEFAULT_OWNER_PERMISSIONS: GroupPermissions = {
  sendMessages: true,
  viewMemberList: true,
  inviteMembers: true,
  kickMembers: true,
  manageRoles: true,
  assignRoles: true,
  editGroupSettings: true,
  deleteGroup: true,
};

export const DEFAULT_ADMIN_PERMISSIONS: GroupPermissions = {
  sendMessages: true,
  viewMemberList: true,
  inviteMembers: true,
  kickMembers: true,
  manageRoles: true,
  assignRoles: true,
  editGroupSettings: true,
  deleteGroup: false,
};

export const DEFAULT_MEMBER_PERMISSIONS: GroupPermissions = {
  sendMessages: true,
  viewMemberList: true,
  inviteMembers: false,
  kickMembers: false,
  manageRoles: false,
  assignRoles: false,
  editGroupSettings: false,
  deleteGroup: false,
};

// ============================================================================
// Roles
// ============================================================================

export interface GroupRole {
  id: string;
  name: string;
  position: number;
  color?: string;
  permissions: GroupPermissions;
  isDefault: boolean;
  isBuiltIn: boolean;
}

export function createDefaultRoles(ownerName: string = 'Owner'): GroupRole[] {
  return [
    {
      id: crypto.randomUUID(),
      name: ownerName,
      position: 100,
      color: '#FFD700',
      permissions: DEFAULT_OWNER_PERMISSIONS,
      isDefault: false,
      isBuiltIn: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Admin',
      position: 50,
      color: '#6E59A5',
      permissions: DEFAULT_ADMIN_PERMISSIONS,
      isDefault: false,
      isBuiltIn: false,
    },
    {
      id: crypto.randomUUID(),
      name: 'Member',
      position: 10,
      permissions: DEFAULT_MEMBER_PERMISSIONS,
      isDefault: true,
      isBuiltIn: false,
    },
  ];
}
