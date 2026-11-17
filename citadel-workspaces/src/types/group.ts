/**
 * Group Types Barrel
 *
 * Re-exports all group chat types from their split modules.
 */

// Permissions & Roles
export type { GroupPermissions, GroupRole } from './group-permissions';
export {
  DEFAULT_OWNER_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_MEMBER_PERMISSIONS,
  createDefaultRoles,
} from './group-permissions';

// Entity Types
export type {
  GroupMember,
  GroupSettings,
  GroupConversation,
  GroupMessage,
  GroupMessageType,
  GroupMemberWithRole,
  CreateGroupState,
} from './group-entities';

// Helper Functions
export {
  canPerformAction,
  canManageUser,
  getOwnerRole,
  getDefaultRole,
  resolveRoleId,
  sortMembers,
} from './group-helpers';
