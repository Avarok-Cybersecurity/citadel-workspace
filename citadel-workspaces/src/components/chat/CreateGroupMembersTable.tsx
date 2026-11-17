/**
 * CreateGroupMembersTable Component
 *
 * Renders the table of selected members with role assignment and removal
 * for the CreateGroupDialog.
 */

import { X, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { GroupRole } from '@/types/group';
import type { SelectedMember } from './create-group-types';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { peerDisplayName, peerHandleName } from '@/lib/peer-display';



interface MembersTableProps {
  selectedMembers: SelectedMember[];
  assignableRoles: GroupRole[];
  defaultRoles: GroupRole[];
  onRoleChange: (cid: string, roleId: string) => void;
  onRemoveMember: (cid: string) => void;
}

export function MembersTable({
  selectedMembers,
  assignableRoles,
  defaultRoles: _defaultRoles,
  onRoleChange,
  onRemoveMember,
}: MembersTableProps): JSX.Element {
  if (selectedMembers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center">
        <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          Add members to your group using the button above
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground h-9">User</TableHead>
            <TableHead className="text-muted-foreground h-9 w-32">Role</TableHead>
            <TableHead className="text-muted-foreground h-9 w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {selectedMembers.map((member) => (
            <TableRow
              key={member.cid}
              className="border-border hover:bg-surface"
            >
              <TableCell className="py-2">
                <div className="flex items-center gap-2">
                  <MemberAvatar username={peerHandleName(member)} name={peerDisplayName(member)} />
                  <span className="text-sm text-foreground">{peerDisplayName(member)}</span>
                </div>
              </TableCell>
              <TableCell className="py-2">
                <Select
                  value={member.roleId}
                  onValueChange={value => onRoleChange(member.cid, value)}
                >
                  <SelectTrigger
              aria-label={`Role for ${member.username}`} className="h-8 w-28 bg-surface text-foreground text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    {assignableRoles.map(r => (
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
              </TableCell>
              <TableCell className="py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="tap-target h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-transparent"
                  aria-label={`Remove ${member.username} from the group`}
                  onClick={() => onRemoveMember(member.cid)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
