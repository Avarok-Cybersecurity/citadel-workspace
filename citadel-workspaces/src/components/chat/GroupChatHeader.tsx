/**
 * GroupChatHeader Component
 *
 * Header for the group chat view showing group name, member avatars,
 * and action buttons (settings, leave).
 */

import { useState, type ReactNode } from 'react';
import { Settings, LogOut, Users, ChevronDown, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { GroupConversation } from '@/types/group';
import { useGroupPermissions } from '@/hooks/use-group-permissions';
import { GroupMemberAvatars } from './GroupMemberAvatars';
import type { GroupSettingsTab } from './group-settings-types';
import { useShareLauncher, type ShareLauncher } from '@/components/share/use-share-launcher';

// ============================================================================
// Types
// ============================================================================

interface GroupChatHeaderProps {
  group: GroupConversation;
  /** Open the settings panel on the tab the chosen menu item names. */
  onOpenSettings: (tab: GroupSettingsTab) => void;
  /** Callback when user leaves the group */
  onLeaveGroup: () => Promise<void>;
  /** Call entry/leave controls, supplied by the surface that knows the roster. */
  callControls?: ReactNode;
}

// ============================================================================
// Component
// ============================================================================

export function GroupChatHeader({
  group,
  onOpenSettings,
  onLeaveGroup,
  callControls,
}: GroupChatHeaderProps): JSX.Element {
  const { isOwner, can } = useGroupPermissions(group);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const share: ShareLauncher = useShareLauncher();

  // Handle leave confirmation
  const handleLeaveConfirm = async (): Promise<void> => {
    setIsLeaving(true);
    try {
      await onLeaveGroup();
    } finally {
      setIsLeaving(false);
      setShowLeaveConfirm(false);
    }
  };

  // Check if user can access settings
  const canAccessSettings: boolean = can('editGroupSettings') || can('manageRoles');

  // `viewMemberList` was offered as a switch in the role editor, summarised in
  // the role list, and read by nothing -- so a role with it off saw the whole
  // membership anyway. Both the avatar strip and the count disclose it.
  const canSeeMembers: boolean = can('viewMemberList');

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
      {/* Left: Group Info. min-w-0 lets the name truncate at narrow widths
          instead of shoving the call controls off-screen. */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Overlapping Avatars */}
        {canSeeMembers && <GroupMemberAvatars group={group} />}

        {/* Group Name & Member Count */}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground truncate">{group.name}</h2>
          {canSeeMembers && (
            <p className="text-xs text-muted-foreground">
              {group.members.length} member{group.members.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {callControls}
        {/* Settings Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Group settings"
              className="h-8 px-2 text-muted-foreground hover:text-foreground hover:bg-surface"
            >
              <Settings className="h-4 w-4 mr-1" />
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 bg-background border-border"
          >
            {canAccessSettings && (
              <>
                {/* Both items used to open the panel on its default, Members, so
                    "Group Settings" opened the member list. Settings when this
                    member may edit them; otherwise Roles, the other half of
                    what grants this item. */}
                <DropdownMenuItem
                  onClick={() => onOpenSettings(can('editGroupSettings') ? 'settings' : 'roles')}
                  className="text-foreground hover:bg-surface cursor-pointer"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Group Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
              </>
            )}
            <DropdownMenuItem
              onClick={() => onOpenSettings('members')}
              className="text-foreground hover:bg-surface cursor-pointer"
            >
              <Users className="h-4 w-4 mr-2" />
              View Members
            </DropdownMenuItem>
            {/* A secure link may name the members as of now, so only someone who can see them offers it. */}
            <DropdownMenuItem
              onClick={() => share.open({ kind: 'group-chat', groupId: group.id, name: group.name, members: canSeeMembers ? group.members.map((m) => m.username) : [] })}
              className="text-foreground hover:bg-surface cursor-pointer"
              data-testid="group-share"
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share…
            </DropdownMenuItem>
            {!isOwner && (
              <>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={() => setShowLeaveConfirm(true)}
                  className="text-destructive-emphasis hover:bg-destructive/10 cursor-pointer"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Leave Group
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {share.dialog}
      {/* Leave Confirmation Dialog */}
      <AlertDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Leave "{group.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              You will no longer receive messages from this group. You can be
              re-invited by a group admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isLeaving}
              className="bg-transparent border-border text-foreground hover:bg-surface"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeaveConfirm}
              disabled={isLeaving}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {isLeaving ? 'Leaving...' : 'Leave Group'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default GroupChatHeader;
