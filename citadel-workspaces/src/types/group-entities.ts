/**
 * Group Entity Types
 *
 * Members, settings, conversations, messages, and UI state types
 * for group chats.
 */

import type { GroupRole } from './group-permissions';

// ============================================================================
// Members
// ============================================================================

export interface GroupMember {
  cid: bigint;
  username: string;
  roleId: string;
  joinedAt: number;
}

// ============================================================================
// Group Settings
// ============================================================================

export interface GroupSettings {
  defaultRoleId: string;
  roles: GroupRole[];
}

// ============================================================================
// Group Conversation
// ============================================================================

export interface GroupConversation {
  id: string;
  name: string;
  ownerId: bigint;
  members: GroupMember[];
  settings: GroupSettings;
  unreadCount: number;
  lastMessageTime?: number;
  lastMessagePreview?: string;
  /**
   * Learnt from the agent's list of this session's groups, so only its key is
   * known: the name, roles and roster arrive with the first member's answer to
   * a state request (see learn-joined-groups.ts).
   */
  awaitingState?: boolean;
}

// ============================================================================
// UI State Types
// ============================================================================

export interface GroupMemberWithRole extends GroupMember {
  role: GroupRole;
}

export interface CreateGroupState {
  name: string;
  selectedPeers: Array<{
    cid: bigint;
    username: string;
    roleId: string;
  }>;
  settings: GroupSettings;
}
