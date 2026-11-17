import type { AvailablePeer } from './create-group-types';
/**
 * Types for GroupSettingsPanel component.
 */

import type { GroupConversation, GroupSettings as GroupSettingsType } from '@/types/group';

/** The panel's tabs. The menu item that opens the panel names which one it means. */
export type GroupSettingsTab = 'members' | 'roles' | 'settings';

export interface GroupSettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: GroupSettingsTab;
  onTabChange: (tab: GroupSettingsTab) => void;
  group: GroupConversation;
  /** Callback when group name is changed */
  onNameChange: (name: string) => Promise<void>;
  /** Callback when settings are changed */
  onSettingsChange: (settings: GroupSettingsType) => void;
  /** Callback when a member's role is changed */
  onMemberRoleChange: (memberCid: string, roleId: string) => Promise<void>;
  /** Callback when a member is kicked */
  onKickMember: (memberCid: string) => Promise<void>;
  /** Callback when the group is deleted */
  onDeleteGroup: () => Promise<void>;
  /** Peers who can still be invited. */
  invitablePeers?: AvailablePeer[];
  /** Callback when a peer is invited. Omit to hide the invite control. */
  onInviteMember?: (peerCid: string) => Promise<void>;
}
