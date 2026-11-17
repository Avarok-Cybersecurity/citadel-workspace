/**
 * Types for the CreateGroupDialog component family.
 */

export interface AvailablePeer {
  cid: string;
  username: string;
  /** True, false, or null when no poll has landed. See lib/presence.ts. */
  isOnline: boolean | null;
}

export interface SelectedMember {
  cid: string;
  username: string;
  roleId: string;
}

export interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Available peers that can be added to the group */
  availablePeers: AvailablePeer[];
  /** Callback when group is created */
  onCreateGroup: (
    name: string,
    members: Array<{ cid: string; username: string; roleId: string }>
  ) => Promise<void>;
  /** Current user's username (used as default group name) */
  currentUsername: string;
}
