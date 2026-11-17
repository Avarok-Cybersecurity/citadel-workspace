/**
 * Types for useGroupConversations hook
 */

import type {
  GroupConversation,
} from '@/types/group';

// ============================================================================
// Types
// ============================================================================

export interface UseGroupConversationsResult {
  /**
   * False until the persisted group restore has finished. A consumer that looks
   * a group up before this is true has learned nothing about whether it exists —
   * `getGroup` reads synchronously and the restore is asynchronous.
   */
  hydrated: boolean;
  /** All group conversations */
  groups: GroupConversation[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Create a new group */
  createGroup: (
    name: string,
    initialMembers: Array<{ cid: string; username: string; roleId?: string }>
  ) => Promise<string>;
  /** Invite a peer to a group */
  /**
   * Invite a peer. GroupInvite carries no role field, so a caller wanting a
   * specific role calls updateMemberRole after this resolves — folding it in
   * here would just hide a second request behind a parameter.
   */
  invitePeer: (groupId: string, peerCid: string) => Promise<void>;
  /** Leave a group */
  leaveGroup: (groupId: string) => Promise<void>;
  /** Kick a member from a group */
  kickMember: (groupId: string, memberCid: string) => Promise<void>;
  /** Update a member's role */
  updateMemberRole: (groupId: string, memberCid: string, roleId: string) => Promise<void>;
  /** Get a specific group by ID */
  getGroup: (groupId: string) => GroupConversation | undefined;
  /** Refresh groups from server */
  refresh: () => Promise<void>;
}

// ============================================================================
// Protocol Boundary Adapter
// ============================================================================


// One implementation, in lib/wasm-request: this cast is where the app crosses
// into the WASM nominal types, and a grep for it should find every crossing.
export { toInternalServiceRequest } from '@/lib/wasm-request';

// ============================================================================
// Constants
// ============================================================================

export const STORAGE_KEY: "citadel_group_conversations" = 'citadel_group_conversations';
