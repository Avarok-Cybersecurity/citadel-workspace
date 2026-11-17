/**
 * Constants and types for GroupRoleEditor component.
 */

import type { GroupPermissions } from '@/types/group';

// ============================================================================
// Types
// ============================================================================

export interface GroupRoleEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Role to edit, or null for creating a new role */
  role: import('@/types/group').GroupRole | null;
  /** Existing roles (for position validation) */
  existingRoles: import('@/types/group').GroupRole[];
  /** Suggested position for new roles */
  suggestedPosition: number;
  /** Callback when role is saved */
  onSave: (role: Omit<import('@/types/group').GroupRole, 'id' | 'isBuiltIn'>) => void;
}

// ============================================================================
// Constants
// ============================================================================

export const PRESET_COLORS: string[] = [
  '#FFD700', // Gold
  '#6E59A5', // Purple
  '#4F46E5', // Indigo
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#EC4899', // Pink
  '#3B82F6', // Blue
  '#14B8A6', // Teal
];

export const PERMISSION_LABELS: Record<keyof GroupPermissions, { label: string; description: string }> = {
  sendMessages: {
    label: 'Send Messages',
    description: 'Can send messages in the group chat',
  },
  viewMemberList: {
    label: 'View Member List',
    description: 'Can see all members of the group',
  },
  inviteMembers: {
    label: 'Invite Members',
    description: 'Can invite new people to the group',
  },
  kickMembers: {
    label: 'Kick Members',
    description: 'Can remove members from the group (respects hierarchy)',
  },
  manageRoles: {
    label: 'Manage Roles',
    description: 'Can create, edit, and delete roles below their own',
  },
  assignRoles: {
    label: 'Assign Roles',
    description: 'Can assign roles to members (roles below their own)',
  },
  editGroupSettings: {
    label: 'Edit Group Settings',
    description: 'Can change group name and default role',
  },
  deleteGroup: {
    label: 'Delete Group',
    description: 'Can permanently delete the group',
  },
};
