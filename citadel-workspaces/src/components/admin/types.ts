/**
 * Admin Modal Types
 *
 * Shared type definitions for the AdminModal component and its tabs.
 */

export type AdminEntityType = string;

export type AdminTabType = 'general' | 'members' | 'chat';

export interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: AdminEntityType;
  entityId: string;
  defaultTab?: AdminTabType;
}

export interface AdminTabProps {
  entityType: AdminEntityType;
  entityId: string;
  onClose: () => void;
}

export interface EntityData {
  id: string;
  name: string;
  description: string;
  chatEnabled?: boolean;
  chatRules?: string;
}

export interface MemberData {
  userId: string;
  username: string;
  name?: string;
  avatarUrl?: string;
  /** The legacy mirror, shown only when `roleId` is unknown. */
  role?: string;
  /** Their role in the workspace's role table. */
  roleId?: string;
  /** The level above that gives them access here, by name; undefined when listed on this node. */
  accessViaName?: string;
  /** A live booking link names them a guest (Calendar design §3.6.4): outside the workspace. */
  isGuest: boolean;
}

export interface UpdateEntityParams {
  name?: string;
  description?: string;
}
