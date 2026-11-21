import { useCallback, useState } from 'react';
import WorkspaceService from '@/lib/workspace-service';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';
import type { RoleDefinition } from 'citadel-workspace-client-ts';
// The tab's own type, not a local re-declaration: two structurally similar
// shapes would compile until one of them gained a field.
import type { MemberData } from '../types';

/**
 * The writes the admin members tab performs.
 *
 * Extracted to keep the tab under the file cap, and because both had the same
 * defect worth fixing in one place: the catch reported "Failed to update member
 * role" / "Failed to remove member" and sent the server's actual refusal to
 * `debugLog`, which is a no-op outside dev. `awaitWriteResponse` produces
 * precise rejections — "Permission denied: EditTreeStructure required", "Cannot
 * demote the only administrator" — and every one of them was being discarded in
 * favour of a sentence that says only that something went wrong. The user
 * retries forever, because nothing tells them retrying cannot work.
 */
export function useMemberAdminActions(
  entityId: string,
  setMembers: React.Dispatch<React.SetStateAction<MemberData[]>>,
): {
  updatingRoles: Set<string>;
  changeRole: (userId: string, newRole: RoleDefinition) => Promise<void>;
  removeMember: (member: MemberData) => Promise<void>;
  setBanned: (member: MemberData, banned: boolean) => Promise<void>;
} {
  const [updatingRoles, setUpdatingRoles] = useState<Set<string>>(new Set());

  const reason = (error: unknown, fallback: string): string =>
    error instanceof Error && error.message ? error.message : fallback;

  // A role from the table: its id is what the server assigns, its name what the toast says.
  const changeRole: (userId: string, newRole: RoleDefinition) => Promise<void> = useCallback(
    async (userId: string, newRole: RoleDefinition) => {
      setUpdatingRoles((prev) => new Set(prev).add(userId));
      try {
        await WorkspaceService.updateMemberRole(userId, newRole.id);
        setMembers((prev) =>
          prev.map((m) => (m.userId === userId ? { ...m, roleId: newRole.id } : m)),
        );
        toast({
          title: 'Role Updated',
          description: `Member role updated to ${newRole.name}`,
          variant: 'success',
        });
      } catch (error) {
        debugLog('MembersTab', 'Failed to update role:', error);
        toast({
          title: 'Could not change that role',
          description: reason(error, 'The server did not accept the change.'),
          variant: 'destructive',
        });
      } finally {
        setUpdatingRoles((prev) => {
          const next: Set<string> = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    },
    [setMembers],
  );

  const removeMember: (member: MemberData) => Promise<void> = useCallback(
    async (member: MemberData) => {
      try {
        await WorkspaceService.removeMember(member.userId, entityId);
        setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
        toast({
          title: 'Member Removed',
          description: `${member.name || member.username} has been removed`,
          variant: 'success',
        });
      } catch (error) {
        debugLog('MembersTab', 'Failed to remove member:', error);
        toast({
          title: 'Could not remove that member',
          description: reason(error, 'The server did not accept the change.'),
          variant: 'destructive',
        });
      }
    },
    [entityId, setMembers],
  );

  // The roster reloads once the server confirms (member-operations), which brings the role an
  // unban gave back; until then the row shows the standing the server just accepted.
  const setBanned: (member: MemberData, banned: boolean) => Promise<void> = useCallback(
    async (member: MemberData, banned: boolean) => {
      const who: string = member.name || member.username;
      try {
        await WorkspaceService.setBanned(member.userId, banned);
        setMembers((prev) => prev.map((m) => (m.userId === member.userId ? { ...m, banned, roleId: undefined } : m)));
        toast({ title: banned ? 'Member Banned' : 'Ban Lifted', description: banned ? `${who} is banned from the workspace` : `${who} may use the workspace again`, variant: 'success' });
      } catch (error) {
        debugLog('MembersTab', 'Failed to change ban:', error);
        toast({
          title: banned ? 'Could not ban that member' : 'Could not lift that ban',
          description: reason(error, 'The server did not accept the change.'),
          variant: 'destructive',
        });
      }
    },
    [setMembers],
  );

  return { updatingRoles, changeRole, removeMember, setBanned };
}
