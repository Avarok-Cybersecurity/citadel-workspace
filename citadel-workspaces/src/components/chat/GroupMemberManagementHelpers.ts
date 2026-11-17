import type { AvailablePeer } from './create-group-types';
/**
 * Types, constants, and helpers for GroupMemberManagement component.
 */

import { Crown, Shield, User } from 'lucide-react';
import { createElement } from 'react';
import type { GroupConversation, GroupRole } from '@/types/group';

// ============================================================================
// Types
// ============================================================================

export interface GroupMemberManagementProps {
  group: GroupConversation;
  /** Callback when a member's role is changed */
  onRoleChange: (memberCid: string, roleId: string) => Promise<void>;
  /** Callback when a member is kicked */
  onKickMember: (memberCid: string) => Promise<void>;
  /** Peers who can still be invited — callers exclude anyone already a member. */
  invitablePeers?: AvailablePeer[];
  /** Callback when a peer is invited. Omit to hide the invite control entirely. */
  onInviteMember?: (peerCid: string) => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================


// ============================================================================
// Helpers
// ============================================================================

/** Get role icon based on position in hierarchy */
export function getRoleIcon(role: GroupRole): React.ReactElement {
  if (role.position >= 100) {
    return createElement(Crown, { className: 'h-4 w-4 text-warning-emphasis' });
  }
  if (role.position >= 50) {
    return createElement(Shield, { className: 'h-4 w-4 text-primary-accent' });
  }
  return createElement(User, { className: 'h-4 w-4 text-muted-foreground' });
}

/** Get avatar color from role or cycle through palette */
