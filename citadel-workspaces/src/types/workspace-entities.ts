/**
 * Entity type definitions for workspace data structures
 * These mirror the Rust structs defined in the backend
 */

// Base entity interface
export interface Entity {
  id: string;
  createdAt: number;
  updatedAt: number;
}

// User entity (Member in workspace context)
export interface User extends Entity {
  username: string;
  displayName: string;
  profileImage?: string;
  avatarUrl?: string; // URL to user's avatar image
  email?: string; // User's email address
  title?: string; // Job title, shown to other members
  /** Their published request policy; undefined when unpublished. See lib/profile-privacy.ts. */
  acceptsRequestsFromStrangers?: boolean;
  /** Their published Online Status choice; undefined when unpublished. See lib/presence.ts. */
  showsOnlineStatus?: boolean;
  /** Whether the server sends their picture, email and title to non-contacts. See lib/profile-privacy.ts. */
  showProfileToStrangers?: boolean;
  /** True, false, or null when nobody has said. See lib/presence.ts. */
  isOnline: boolean | null;
  /** The legacy role mirror, as the wire sends it ('Admin', 'Banned'...). Display only, as a fallback. */
  role?: string;
  /** Their role in the workspace's role table; see lib/workspace-roles. */
  roleId?: string;
  permissions?: UserPermissions;
  lastActive?: number; // Timestamp of last activity
  /**
   * On a node's member list only: the level above (node or workspace id) whose
   * membership gives them access here. Undefined when they are listed on the
   * node itself, and on any other list. See lib/member-access.ts.
   */
  accessVia?: string;
}

// Permission settings for users
export interface UserPermissions {
  canCreateNodes: boolean;
  canDeleteNodes: boolean;
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canUpdateNodes: boolean;
  canEditMdxContent: boolean;
  domainId: string; // ID of the domain these permissions apply to
}

// Message types
export interface Message extends Entity {
  content: string;
  senderId: string;
  receiverId?: string;
  nodeId?: string;
  type: MessageType;
}

export enum MessageType {
  Text = 'text',
  File = 'file',
  System = 'system'
}

// Re-export generated GroupMessageType (string literal union: "Text" | "Markdown" | "System")
// This replaces the local enum to maintain type compatibility with generated GroupMessage
export type { GroupMessageType } from 'citadel-workspace-client-ts';

// Extend generated GroupMessage with local-only fields
import type { GroupMessage as GeneratedGroupMessage } from 'citadel-workspace-client-ts';
import type { GroupFileShare } from './group-file-share';
export interface GroupMessage extends GeneratedGroupMessage {
  /** A file shared into a peer group; local-only, see types/group-file-share. */
  file_share?: GroupFileShare;
  /** A node channel's come from the server (the same shape); a peer group keeps its own in the stored transcript. See lib/reactions. */
  reactions?: import('@/lib/reactions/reaction-state').MessageReaction[];
}
