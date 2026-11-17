/**
 * CreateGroupDialog Component
 *
 * Modal dialog for creating a new custom peer group.
 * Allows setting group name, settings, and selecting initial members with roles.
 */

import { useState, useMemo, useCallback } from 'react';
import { Plus, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createDefaultRoles, getDefaultRole } from '@/types/group';
import { debugLog } from '@/lib/debug-config';
import { MembersTable } from './CreateGroupMembersTable';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { peerDisplayName, peerHandleName } from '@/lib/peer-display';
import type { AvailablePeer, SelectedMember, CreateGroupDialogProps } from './create-group-types';
import type { GroupRole } from '@/types/group-permissions';

// Re-export types for backward compatibility
export type { AvailablePeer, SelectedMember, CreateGroupDialogProps };


export function CreateGroupDialog({
  open,
  onOpenChange,
  availablePeers,
  onCreateGroup,
  currentUsername,
}: CreateGroupDialogProps): JSX.Element {
  const defaultRoles: GroupRole[] = useMemo((): GroupRole[] => createDefaultRoles(), []);
  const memberRole: GroupRole | undefined = useMemo(
    () => getDefaultRole({ roles: defaultRoles, defaultRoleId: '' }),
    [defaultRoles]
  );

  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showPeerSelector, setShowPeerSelector] = useState(false);

  const displayName: string = groupName.trim() || `${currentUsername}'s Group`;

  const unselectedPeers: AvailablePeer[] = useMemo(() => {
    const selectedCids: Set<string> = new Set(selectedMembers.map(m => m.cid));
    return availablePeers.filter(p => !selectedCids.has(p.cid));
  }, [availablePeers, selectedMembers]);

  const assignableRoles: GroupRole[] = useMemo((): GroupRole[] => {
    return defaultRoles.filter(r => !r.isBuiltIn);
  }, [defaultRoles]);

  const handleAddMember: (peer: AvailablePeer) => void = useCallback(
    (peer: AvailablePeer) => {
      const newMember: SelectedMember = {
        cid: peer.cid,
        username: peer.username,
        roleId: memberRole?.id || defaultRoles[2].id,
      };
      setSelectedMembers(prev => [...prev, newMember]);
      setShowPeerSelector(false);
    },
    [memberRole, defaultRoles]
  );

  const handleRemoveMember: (cid: string) => void = useCallback((cid: string): void => {
    setSelectedMembers(prev => prev.filter(m => m.cid !== cid));
  }, []);

  const handleRoleChange: (cid: string, roleId: string) => void = useCallback((cid: string, roleId: string): void => {
    setSelectedMembers(prev =>
      prev.map(m => (m.cid === cid ? { ...m, roleId } : m))
    );
  }, []);

  const handleCreate: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (selectedMembers.length === 0) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await onCreateGroup(displayName, selectedMembers);
      setGroupName('');
      setSelectedMembers([]);
      onOpenChange(false);
    } catch (error) {
      debugLog('CreateGroupDialog', 'Failed to create group:', error);
      // Shown, not only logged. debugLog compiles to a no-op outside dev, so
      // this failure left the dialog open with the form intact and NOTHING
      // said — the user cannot tell a failure from a slow request, and clicks
      // Create again.
      setCreateError('Could not create the group. Check your connection and try again.');
    } finally {
      setIsCreating(false);
    }
  }, [displayName, selectedMembers, onCreateGroup, onOpenChange]);

  // No `if (!isCreating)` guard: onOpenChange is Radix's SINGLE dismissal
  // channel, so guarding it disables the X, Escape and outside-click together,
  // while the submit button is disabled too. See shared/confirm-dialog.
  const handleClose: () => void = useCallback((): void => {
    setGroupName('');
    setSelectedMembers([]);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Users className="h-5 w-5 text-primary-accent" />
            Create New Group
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a group chat with your P2P peers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Group Name Section */}
          <div className="space-y-2">
            <Label htmlFor="groupName" className="text-sm text-foreground/80">
              Group Name
            </Label>
            <Input
              id="groupName"
              data-testid="create-group-name"
              placeholder={`${currentUsername}'s Group`}
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              className="bg-surface border-border text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use default: "{currentUsername}'s Group"
            </p>
          </div>

          {/* Members Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-foreground/80">Members</Label>
              <Popover open={showPeerSelector} onOpenChange={setShowPeerSelector}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="create-group-add-member"
                    disabled={unselectedPeers.length === 0}
                    className="h-8 bg-surface border-border text-foreground hover:bg-border"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Member
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-64 p-2 bg-background border-border"
                  align="end"
                >
                  <ScrollArea className="max-h-48">
                    {unselectedPeers.length === 0 ? (
                      <p className="text-sm text-muted-foreground p-2">
                        No more peers available
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {unselectedPeers.map(peer => (
                          <button
                            key={peer.cid}
                            data-testid={`create-group-peer-${peer.username}`}
                            onClick={() => handleAddMember(peer)}
                            className="w-full flex items-center gap-2 p-2 rounded hover:bg-surface text-left"
                          >
                            <MemberAvatar username={peerHandleName(peer)} name={peerDisplayName(peer)} />
                            <span className="text-sm text-foreground flex-1 truncate">
                              {peerDisplayName(peer)}
                            </span>
                            {peer.isOnline && (
                              <span className="w-2 h-2 rounded-full bg-success" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>

            <MembersTable
              selectedMembers={selectedMembers}
              assignableRoles={assignableRoles}
              defaultRoles={defaultRoles}
              onRoleChange={handleRoleChange}
              onRemoveMember={handleRemoveMember}
            />
          </div>
        </div>

        {createError && (
          <p role="alert" className="px-1 text-sm text-destructive-emphasis">
            {createError}
          </p>
        )}

        <DialogFooter className="gap-2">
          {/* Backing out of an in-flight create is always legitimate. */}
          <Button
            variant="outline"
            onClick={handleClose}
            className="bg-transparent border-border text-foreground hover:bg-surface"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            data-testid="create-group-submit"
            disabled={selectedMembers.length === 0 || isCreating}
            className="bg-primary text-primary-foreground"
          >
            {isCreating ? 'Creating...' : 'Create Group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateGroupDialog;
