/**
 * GroupMemberManagement Component
 *
 * Displays and manages group members with role assignment and kick functionality.
 * Respects role hierarchy for actions.
 */

import { membersByRank, assignableRoles } from './members-by-rank';
import { groupRestriction, restrictionText, type GroupRestriction } from './group-restriction';
import { useState, useMemo, useCallback } from 'react';
import { UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { GroupMemberWithRole } from '@/types/group';
import { useGroupPermissions } from '@/hooks/use-group-permissions';
import type { GroupMemberManagementProps } from './GroupMemberManagementHelpers';
import { rosterMemberName } from '@/lib/roster-peer-name';
import { KickConfirmDialog } from './KickConfirmDialog';
import { GroupMemberIdentity } from './GroupMemberIdentity';
import { PeerPickerPopover } from './PeerPickerPopover';
import type { GroupRole } from '@/types/group-permissions';

// ============================================================================
// Component
// ============================================================================

export function GroupMemberManagement({
  group,
  onRoleChange,
  onKickMember,
  invitablePeers = [],
  onInviteMember,
}: GroupMemberManagementProps): JSX.Element {
  const { can, canManageMember, canAssignRole, listedAsMember, myRole } = useGroupPermissions(group);
  const [memberToKick, setMemberToKick] = useState<GroupMemberWithRole | null>(null);
  const [isKicking, setIsKicking] = useState(false);

  const sortedMembers: GroupMemberWithRole[] = useMemo(
    (): GroupMemberWithRole[] => membersByRank(group),
    [group],
  );

  // Roles that can be assigned (excludes built-in owner role)
  const roles: GroupRole[] = useMemo((): GroupRole[] => assignableRoles(group), [group]);

  // Handle role change
  const handleRoleChange: (member: GroupMemberWithRole, newRoleId: string) => Promise<void> = useCallback(
    async (member: GroupMemberWithRole, newRoleId: string) => {
      if (newRoleId !== member.roleId) {
        await onRoleChange(member.cid.toString(), newRoleId);
      }
    },
    [onRoleChange]
  );

  // Handle kick confirmation
  const handleKickConfirm = async (): Promise<void> => {
    if (!memberToKick) return;

    setIsKicking(true);
    try {
      await onKickMember(memberToKick.cid.toString());
    } finally {
      setIsKicking(false);
      setMemberToKick(null);
    }
  };

  // Check what actions are available for a member
  const canKick: boolean = can('kickMembers');
  const canAssign: boolean = can('assignRoles');

  const viewRestriction: GroupRestriction = groupRestriction(listedAsMember, myRole !== undefined, can('viewMemberList'));
  if (viewRestriction !== 'allowed') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground" data-testid="group-members-restricted">
          {restrictionText(viewRestriction, 'see the member list')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Members ({group.members.length})
        </h3>
        {/* Only offered to members whose role permits it, and only when the
            caller supplied a handler — inviting was previously unreachable
            entirely, invitePeer having had no caller anywhere. */}
        {onInviteMember && can('inviteMembers') && (
          <PeerPickerPopover
            peers={invitablePeers}
            label="Invite"
            emptyMessage="Everyone you have registered is already in this group"
            data-testid="group-invite-picker"
            onSelect={(peer) => { void onInviteMember(peer.cid); }}
          />
        )}
      </div>

      {/* Member Table */}
      <ScrollArea className="max-h-[400px]">
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground h-10">Member</TableHead>
                <TableHead className="text-muted-foreground h-10 w-40">Role</TableHead>
                {canKick && (
                  <TableHead className="text-muted-foreground h-10 w-20 text-right">
                    Actions
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMembers.map((member) => {
                const isOwnerMember: boolean = member.cid === group.ownerId;
                const canManageThis: boolean = canManageMember(member.cid);
                const canAssignThis: boolean = canAssign && canAssignRole(member.roleId);

                return (
                  <TableRow
                    key={member.cid}
                    className="border-border hover:bg-surface"
                  >
                    {/* Member Info */}
                    <TableCell className="py-3">
                      <GroupMemberIdentity member={member} isOwner={isOwnerMember} />
                    </TableCell>

                    {/* Role Selector */}
                    <TableCell className="py-3">
                      {canAssignThis && !isOwnerMember ? (
                        <Select
                          value={member.roleId}
                          onValueChange={value => handleRoleChange(member, value)}
                        >
                          <SelectTrigger
              aria-label={`Role for ${rosterMemberName(member)}`} className="h-8 w-32 bg-surface text-foreground text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-border">
                            {roles
                              .filter(r => canAssignRole(r.id))
                              .map(r => (
                                <SelectItem
                                  key={r.id}
                                  value={r.id}
                                  className="text-foreground hover:bg-surface"
                                >
                                  <div className="flex items-center gap-2">
                                    {r.color && (
                                      <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: r.color }}
                                      />
                                    )}
                                    {r.name}
                                  </div>
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-foreground/80">
                          {member.role.color && (
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: member.role.color }}
                            />
                          )}
                          {member.role.name}
                        </div>
                      )}
                    </TableCell>

                    {/* Actions */}
                    {canKick && (
                      <TableCell className="py-3 text-right">
                        {canManageThis && !isOwnerMember ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setMemberToKick(member)}
                            title="Kick member"
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        ) : (
                          <div className="h-7 w-7" />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>

      {/* Kick Confirmation Dialog */}
      <KickConfirmDialog
        member={memberToKick}
        isKicking={isKicking}
        onOpenChange={() => setMemberToKick(null)}
        onConfirm={handleKickConfirm}
      />
    </div>
  );
}

export default GroupMemberManagement;
